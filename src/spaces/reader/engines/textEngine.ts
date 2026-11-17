import { marked } from "marked";
import type { ThemeName } from "../../../config/tokens";
import { stackFor, type TypographySettings } from "../../../config/typography";
import { sentenceAroundSelection } from "../../../lib/selectionContext";
import { fetchBookText } from "../../../services/bookData";
import { excerptAround, quoteContext, takeGraphemes, type LocatorEnvelope } from "../locator";
import type {
  BookTextSection,
  ChapterPosition,
  EngineAnnotation,
  EngineOpenArgs,
  EngineSelection,
  LocatorContext,
  ReaderEngine,
  SearchHit,
  TocEntry,
} from "./types";

const COLUMN_GAP = 64;

interface TextPosition {
  blockIndex: number;
  charOffset: number;
}

/**
 * Saved web pages often wrap the whole text in one or two container
 * elements. Lift their children up so paragraphs and headings are the
 * blocks the reader navigates by, not one book-sized block.
 */
function unwrapSoleContainers(flow: HTMLElement): void {
  for (let depth = 0; depth < 6; depth++) {
    if (flow.children.length !== 1) return;
    const only = flow.children[0];
    if (!/^(DIV|SECTION|ARTICLE|MAIN)$/.test(only.tagName) || only.children.length === 0) return;
    only.replaceWith(...Array.from(only.childNodes));
  }
}

/**
 * Reflowable text engine for TXT / Markdown / simple HTML. Content is
 * sanitized (scripts, handlers, external references stripped) and rendered
 * as real DOM text, paginated with CSS columns. Locators anchor to block
 * index (ADR 0004 "text" family).
 */
export class TextEngine implements ReaderEngine {
  private container: HTMLElement | null = null;
  private page: HTMLElement | null = null;
  private flow: HTMLElement | null = null;
  private notify: ((l: LocatorEnvelope, c: LocatorContext) => void) | null = null;
  private pageIndex = 0;
  private pageCount = 1;
  private blocks: HTMLElement[] = [];
  /** the passage at the top of the page; what a reflow must return to */
  private position: TextPosition = { blockIndex: 0, charOffset: 0 };
  /** a displayed target, held until the reader turns a page themselves */
  private anchor: TextPosition | null = null;
  /** nothing is announced (or autosaved) before the first display */
  private displayed = false;
  private fontListener: (() => void) | null = null;
  private chapters: { start: number; end: number; title: string | null }[] = [];
  private blockOffsets: number[] = [];
  private totalChars = 0;
  private resizeObserver: ResizeObserver | null = null;
  private language: string | null = null;
  private selectionHandler: ((sel: EngineSelection | null) => void) | null = null;
  private selectionListener: (() => void) | null = null;
  private externalLinkHandler: ((url: string) => void) | null = null;
  private linkListener: ((event: MouseEvent) => void) | null = null;

  async open(args: EngineOpenArgs): Promise<void> {
    this.container = args.container;
    this.notify = args.onLocatorChanged;
    this.language = args.book.language;

    const raw = await fetchBookText(args.fileUrl);
    const html =
      args.book.sourceFormat === "md"
        ? await marked.parse(raw, { async: true })
        : args.book.sourceFormat === "html"
          ? raw
          : plainTextToHtml(raw);

    this.page = document.createElement("div");
    this.page.className = "text-engine-page";
    this.flow = document.createElement("div");
    this.flow.className = "text-engine-flow";
    this.flow.innerHTML = sanitizeTextHtml(html);
    this.page.appendChild(this.flow);
    this.container.appendChild(this.page);

    this.linkListener = (event) => {
      const anchor = (event.target as Element | null)?.closest?.("a[data-external-href]");
      const url = anchor?.getAttribute("data-external-href");
      if (!url) return;
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) this.externalLinkHandler?.(url);
    };
    this.flow.addEventListener("click", this.linkListener);

    unwrapSoleContainers(this.flow);
    this.blocks = Array.from(this.flow.children) as HTMLElement[];
    this.buildChapters();
    this.applyTypography(args.typography);

    this.resizeObserver = new ResizeObserver(() => this.reflow());
    this.resizeObserver.observe(this.container);
    // A web font arriving after the first layout re-wraps every line; hold
    // the passage through it instead of the page number.
    this.fontListener = () => this.reflow();
    document.fonts?.addEventListener?.("loadingdone", this.fontListener);
  }

  /** Recompute column pagination after size/typography changes. */
  private reflow(keep?: TextPosition): void {
    if (!this.page || !this.flow || !this.container) return;
    // Hold the passage, not the block: a block can run for many pages, and
    // returning to its first line is how a reader gets thrown backwards.
    if (keep) this.anchor = keep;
    const anchor = this.anchor ?? this.position;
    const w = this.page.clientWidth;
    this.flow.style.columnWidth = `${w}px`;
    this.flow.style.columnGap = `${COLUMN_GAP}px`;
    this.pageCount = Math.max(
      1,
      Math.round((this.flow.scrollWidth + COLUMN_GAP) / (w + COLUMN_GAP)),
    );
    this.setPage(this.pageOfPosition(anchor), false);
  }

  private pageWidth(): number {
    return (this.page?.clientWidth ?? 0) + COLUMN_GAP;
  }

  /** The flow's real horizontal offset right now, even mid-animation. */
  private visualOffset(): number {
    if (!this.flow) return 0;
    const transform = getComputedStyle(this.flow).transform;
    if (!transform || transform === "none") return 0;
    try {
      return -new DOMMatrixReadOnly(transform).m41;
    } catch {
      return this.pageIndex * this.pageWidth();
    }
  }

  private firstVisiblePosition(): TextPosition {
    if (!this.page) return { blockIndex: 0, charOffset: 0 };
    const pageRect = this.page.getBoundingClientRect();
    const doc = this.page.ownerDocument as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    for (const inset of [8, 24, 48, 80]) {
      const caret = doc.caretRangeFromPoint?.(pageRect.left + 12, pageRect.top + inset);
      const node = caret?.startContainer;
      if (!caret || !node || !this.flow?.contains(node)) continue;
      const blockIndex = this.blocks.findIndex((block) => block.contains(node));
      if (blockIndex === -1) continue;
      const before = caret.cloneRange();
      before.selectNodeContents(this.blocks[blockIndex]);
      before.setEnd(node, caret.startOffset);
      return { blockIndex, charOffset: before.toString().length };
    }
    for (let i = 0; i < this.blocks.length; i++) {
      const rects = Array.from(this.blocks[i].getClientRects());
      if (rects.some((rect) => rect.right > pageRect.left && rect.left < pageRect.right)) {
        return { blockIndex: i, charOffset: 0 };
      }
    }
    return { blockIndex: 0, charOffset: 0 };
  }

  /** Which page a position falls on in the current layout. */
  private pageOfPosition(position: TextPosition): number {
    if (!this.page || this.blocks.length === 0) return 0;
    const block = this.blocks[Math.min(position.blockIndex, this.blocks.length - 1)];
    const width = this.pageWidth();
    if (!block || width <= 0) return 0;
    const pageRect = this.page.getBoundingClientRect();
    let rect: DOMRect | undefined;
    const caret = collapsedRangeAt(block, position.charOffset);
    if (caret) {
      const node = caret.startContainer as Text;
      if (caret.startOffset < node.data.length) caret.setEnd(node, caret.startOffset + 1);
      rect = caret.getClientRects()[0];
    }
    rect ??= block.getClientRects()[0];
    if (!rect) return 0;
    const logicalLeft = rect.left - pageRect.left + this.visualOffset();
    return Math.max(0, Math.min(this.pageCount - 1, Math.floor((logicalLeft + 1) / width)));
  }

  /**
   * Show a page. The position is measured with the page already in its
   * final place — measuring during the turn animation reports the page
   * being left, and that is what would be saved.
   */
  private setPage(index: number, animate: boolean): void {
    const flow = this.flow;
    if (!flow || !this.page) return;
    const from = this.visualOffset();
    this.pageIndex = Math.max(0, Math.min(this.pageCount - 1, index));
    const target = `translateX(-${this.pageIndex * this.pageWidth()}px)`;
    flow.style.transition = "none";
    flow.style.transform = target;
    void flow.offsetWidth;
    this.announce();
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (animate && !reduced && Math.abs(from - this.pageIndex * this.pageWidth()) > 1) {
      flow.style.transform = `translateX(-${from}px)`;
      void flow.offsetWidth;
      flow.style.transition = "";
      flow.style.transform = target;
    } else {
      flow.style.transition = "";
    }
  }

  private goToBlock(blockIndex: number): void {
    this.displayed = true;
    this.reflow({ blockIndex, charOffset: 0 });
  }

  private announce(): void {
    if (!this.notify || !this.displayed) return;
    const position = this.firstVisiblePosition();
    this.position = position;
    const { blockIndex, charOffset } = position;
    const heading = this.nearestHeading(blockIndex);
    const blockText = this.blocks[blockIndex]?.textContent ?? "";
    const exact = takeGraphemes(blockText.substring(charOffset).trimStart(), 32);
    const envelope: LocatorEnvelope = {
      v: 1,
      engine: "text",
      primary: { blockIndex, charOffset },
      textQuote: exact.trim()
        ? {
            exact,
            prefix: takeGraphemes(blockText.substring(0, charOffset), 48, true),
            suffix: "",
          }
        : null,
      coarse: {
        sectionTitle: heading,
        blockIndex,
        pageIndex: this.pageIndex,
        progress: this.pageCount > 1 ? this.pageIndex / (this.pageCount - 1) : 1,
      },
    };
    this.notify(envelope, {
      sectionTitle: heading,
      pageIndex: this.pageIndex,
      chapter: this.chapterPosition(position),
    });
  }

  // ---- chapters (top-level headings) ----

  private buildChapters(): void {
    this.blockOffsets = [];
    let total = 0;
    for (const block of this.blocks) {
      this.blockOffsets.push(total);
      total += (block.textContent ?? "").length;
    }
    this.totalChars = total;
    const starts: number[] = [];
    this.blocks.forEach((el, i) => {
      if (/^H[12]$/.test(el.tagName)) starts.push(i);
    });
    if (starts[0] !== 0) starts.unshift(0);
    this.chapters = starts.map((start, i) => ({
      start,
      end: starts[i + 1] ?? this.blocks.length,
      title: /^H[12]$/.test(this.blocks[start]?.tagName ?? "")
        ? this.blocks[start].textContent?.trim() || null
        : null,
    }));
  }

  private chapterPosition(position: TextPosition): ChapterPosition | null {
    const chapter = this.chapters.find(
      (c) => position.blockIndex >= c.start && position.blockIndex < c.end,
    );
    if (!chapter) return null;
    const startChar = this.blockOffsets[chapter.start] ?? 0;
    const endChar = this.blockOffsets[chapter.end] ?? this.totalChars;
    const at = (this.blockOffsets[position.blockIndex] ?? 0) + position.charOffset;
    const chars = Math.max(0, endChar - startChar);
    return {
      index: this.chapters.indexOf(chapter),
      total: this.chapters.length,
      title: chapter.title,
      fraction: chars > 0 ? Math.min(1, Math.max(0, (at - startChar) / chars)) : 0,
      chars,
      charsLeft: Math.max(0, endChar - at),
      bookCharsLeft: Math.max(0, this.totalChars - at),
    };
  }

  extractText(): Promise<BookTextSection[]> {
    return Promise.resolve(
      this.chapters.map((chapter, index) => ({
        index,
        title: chapter.title,
        text: this.blocks
          .slice(chapter.start, chapter.end)
          .map((el) => (el.textContent ?? "").replace(/\s+/gu, " ").trim())
          .filter((t) => t.length > 0)
          .join("\n"),
      })),
    );
  }

  private nearestHeading(blockIndex: number): string | null {
    for (let i = blockIndex; i >= 0; i--) {
      const el = this.blocks[i];
      if (el && /^H[1-4]$/.test(el.tagName)) return el.textContent?.trim() || null;
    }
    return null;
  }

  display(locator: LocatorEnvelope | null): Promise<void> {
    this.displayed = true;
    this.reflow(
      locator?.engine === "text"
        ? this.resolveTextLocator(locator)
        : { blockIndex: 0, charOffset: 0 },
    );
    return Promise.resolve();
  }

  private resolveTextLocator(locator: Extract<LocatorEnvelope, { engine: "text" }>): {
    blockIndex: number;
    charOffset: number;
  } {
    const preferred = Math.min(locator.primary.blockIndex, Math.max(0, this.blocks.length - 1));
    const exact = locator.textQuote?.exact;
    if (!exact) return { blockIndex: preferred, charOffset: locator.primary.charOffset };
    const order = [preferred, ...this.blocks.map((_, index) => index)];
    let best: { blockIndex: number; charOffset: number; score: number } | null = null;
    for (const blockIndex of Array.from(new Set(order))) {
      const text = this.blocks[blockIndex]?.textContent ?? "";
      let from = 0;
      while (from <= text.length) {
        const at = text.indexOf(exact, from);
        if (at === -1) break;
        const prefix = locator.textQuote?.prefix ?? "";
        const suffix = locator.textQuote?.suffix ?? "";
        const score =
          Number(text.substring(Math.max(0, at - prefix.length), at).endsWith(prefix)) +
          Number(
            text.substring(at + exact.length, at + exact.length + suffix.length).startsWith(suffix),
          ) +
          Number(blockIndex === preferred);
        if (!best || score > best.score) best = { blockIndex, charOffset: at, score };
        from = at + Math.max(1, exact.length);
      }
    }
    return best ?? { blockIndex: preferred, charOffset: locator.primary.charOffset };
  }

  next(): Promise<void> {
    this.anchor = null;
    if (this.pageIndex < this.pageCount - 1) this.setPage(this.pageIndex + 1, true);
    return Promise.resolve();
  }

  prev(): Promise<void> {
    this.anchor = null;
    if (this.pageIndex > 0) this.setPage(this.pageIndex - 1, true);
    return Promise.resolve();
  }

  applyTypography(t: TypographySettings): void {
    if (!this.page || !this.flow) return;
    const family = stackFor(this.language, this.flow.textContent ?? undefined);
    this.page.style.maxWidth = `${t.maxWidthCh}ch`;
    this.flow.style.fontFamily = family;
    this.flow.style.fontSize = `${t.fontSizePx}px`;
    this.flow.style.lineHeight = String(t.lineHeight);
    this.reflow();
  }

  applyTheme(_theme: ThemeName): void {
    // colors flow from CSS custom properties on the shell
  }

  destroy(): void {
    if (this.selectionListener) {
      document.removeEventListener("selectionchange", this.selectionListener);
    }
    if (this.linkListener) this.flow?.removeEventListener("click", this.linkListener);
    if ("highlights" in CSS) CSS.highlights.delete("lectorium-text");
    this.resizeObserver?.disconnect();
    if (this.fontListener) document.fonts?.removeEventListener?.("loadingdone", this.fontListener);
    this.page?.remove();
    this.page = null;
    this.flow = null;
    this.blocks = [];
  }

  toc(): Promise<TocEntry[]> {
    const out: TocEntry[] = [];
    this.blocks.forEach((el, i) => {
      const m = /^H([1-4])$/.exec(el.tagName);
      if (m) {
        out.push({
          label: el.textContent?.trim() ?? "",
          target: `block:${i}`,
          depth: Number(m[1]) - 1,
        });
      }
    });
    return Promise.resolve(out);
  }

  goTo(target: string): Promise<void> {
    const m = /^block:(\d+)$/.exec(target);
    if (m) this.goToBlock(Number(m[1]));
    return Promise.resolve();
  }

  search(query: string): Promise<SearchHit[]> {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return Promise.resolve([]);
    const hits: SearchHit[] = [];
    for (let i = 0; i < this.blocks.length && hits.length < 200; i++) {
      const text = this.blocks[i].textContent ?? "";
      const at = text.toLowerCase().indexOf(needle);
      if (at !== -1) {
        hits.push({
          target: `block:${i}`,
          excerpt: excerptAround(text, at, needle.length),
          sectionTitle: this.nearestHeading(i),
        });
      }
    }
    return Promise.resolve(hits);
  }

  onSelection(handler: (sel: EngineSelection | null) => void): void {
    this.selectionHandler = handler;
    if (!this.selectionListener) {
      this.selectionListener = () => this.emitSelection();
      document.addEventListener("selectionchange", this.selectionListener);
    }
  }

  onExternalLink(handler: (url: string) => void): void {
    this.externalLinkHandler = handler;
  }

  private emitSelection(): void {
    if (!this.selectionHandler || !this.flow) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !this.flow.contains(sel.anchorNode)) {
      this.selectionHandler(null);
      return;
    }
    const text = sel.toString();
    if (!text.trim()) {
      this.selectionHandler(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    let blockIndex = 0;
    for (let i = 0; i < this.blocks.length; i++) {
      if (this.blocks[i].contains(range.startContainer)) {
        blockIndex = i;
        break;
      }
    }
    const block = this.blocks[blockIndex];
    const before = range.cloneRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    const charOffset = before.toString().length;
    const blockText = block.textContent ?? "";
    const envelope: LocatorEnvelope = {
      v: 1,
      engine: "text",
      primary: { blockIndex, charOffset },
      textQuote: quoteContext(blockText, charOffset, charOffset + text.length),
      coarse: { sectionTitle: this.nearestHeading(blockIndex), blockIndex },
    };
    this.selectionHandler({
      text,
      context: sentenceAroundSelection(
        blockText.slice(0, charOffset),
        text,
        blockText.slice(charOffset + text.length),
      ),
      locator: envelope,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  }

  setHighlights(annotations: EngineAnnotation[]): void {
    if (!("highlights" in CSS) || !this.flow) return;
    const ranges: Range[] = [];
    for (const a of annotations) {
      if (a.locator.engine !== "text") continue;
      const exact = a.locator.textQuote?.exact;
      if (!exact) continue;
      const block = this.blocks[a.locator.primary.blockIndex];
      const range = block ? findRangeIn(block, exact) : null;
      if (range) ranges.push(range);
    }
    if (ranges.length > 0) {
      CSS.highlights.set("lectorium-text", new Highlight(...ranges));
    } else {
      CSS.highlights.delete("lectorium-text");
    }
  }
}

function collapsedRangeAt(root: HTMLElement, offset: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (offset <= consumed + node.data.length) {
      const range = document.createRange();
      range.setStart(node, Math.max(0, offset - consumed));
      range.collapse(true);
      return range;
    }
    consumed += node.data.length;
  }
  return null;
}

/** Locate `exact` within one block element, spanning child text nodes. */
function findRangeIn(root: HTMLElement, exact: string): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let full = "";
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    nodes.push(t);
    full += t.data;
  }
  const at = full.indexOf(exact);
  if (at === -1) return null;
  const locate = (offset: number): { node: Text; offset: number } | null => {
    let acc = 0;
    for (const node of nodes) {
      if (offset <= acc + node.data.length) return { node, offset: offset - acc };
      acc += node.data.length;
    }
    return null;
  };
  const start = locate(at);
  const end = locate(at + exact.length);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function plainTextToHtml(raw: string): string {
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return raw
    .split(/\r?\n\s*\r?\n/)
    .filter((p) => p.trim().length > 0)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\r?\n/g, "<br/>")}</p>`)
    .join("\n");
}

/** Strip active content: local files are still untrusted input (ADR 0005). */
export function sanitizeTextHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll(
      "script, style, iframe, object, embed, form, input, button, textarea, select, link, meta, base, svg, math, canvas, video, audio, template",
    )
    .forEach((el) => el.remove());
  const allowed = new Set([
    "a",
    "abbr",
    "article",
    "aside",
    "b",
    "bdi",
    "bdo",
    "blockquote",
    "br",
    "caption",
    "cite",
    "code",
    "dd",
    "div",
    "dl",
    "dt",
    "em",
    "figcaption",
    "figure",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "li",
    "mark",
    "ol",
    "p",
    "pre",
    "q",
    "rp",
    "rt",
    "ruby",
    "s",
    "section",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "time",
    "tr",
    "u",
    "ul",
  ]);
  const elements = Array.from(doc.body.querySelectorAll("*"));
  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    if (!allowed.has(tag)) {
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }
    const semanticClass = /(?:callout|sidebar|box|note|anecdote|quote|epigraph)/i.test(
      el.getAttribute("class") ?? "",
    );
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const rawValue = attr.value.trim();
      const value = rawValue.toLowerCase();
      const globallyAllowed = name === "lang" || name === "dir" || name === "title";
      const tableAllowed =
        (tag === "td" || tag === "th") && ["colspan", "rowspan", "scope"].includes(name);
      const imageAllowed = tag === "img" && ["alt", "width", "height"].includes(name);
      if (globallyAllowed || tableAllowed || imageAllowed) continue;
      if (tag === "a" && name === "href" && /^https?:\/\//i.test(value)) {
        el.setAttribute("data-external-href", rawValue);
      }
      if (
        tag === "img" &&
        name === "src" &&
        /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value)
      ) {
        continue;
      }
      el.removeAttribute(attr.name);
    }
    if (semanticClass) el.classList.add("book-callout");
  }
  return doc.body.innerHTML;
}
