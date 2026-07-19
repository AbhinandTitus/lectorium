import { marked } from "marked";
import type { ThemeName } from "../../../config/tokens";
import { stackFor, type TypographySettings } from "../../../config/typography";
import { sentenceAroundSelection } from "../../../lib/selectionContext";
import { fetchBookText } from "../../../services/bookData";
import { excerptAround, quoteContext, type LocatorEnvelope } from "../locator";
import type {
  EngineAnnotation,
  EngineOpenArgs,
  EngineSelection,
  LocatorContext,
  ReaderEngine,
  SearchHit,
  TocEntry,
} from "./types";

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

    this.blocks = Array.from(this.flow.children) as HTMLElement[];
    this.applyTypography(args.typography);

    this.resizeObserver = new ResizeObserver(() => this.reflow());
    this.resizeObserver.observe(this.container);
  }

  /** Recompute column pagination after size/typography changes. */
  private reflow(keepBlock?: number): void {
    if (!this.page || !this.flow || !this.container) return;
    const anchorBlock = keepBlock ?? this.firstVisibleBlock();
    const w = this.page.clientWidth;
    this.flow.style.columnWidth = `${w}px`;
    this.flow.style.columnGap = "64px";
    this.pageCount = Math.max(1, Math.round((this.flow.scrollWidth + 64) / (w + 64)));
    this.goToBlock(anchorBlock);
  }

  private firstVisibleBlock(): number {
    return this.firstVisiblePosition().blockIndex;
  }

  private firstVisiblePosition(): { blockIndex: number; charOffset: number } {
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
    const pageLeft = this.pageIndex * (this.page.clientWidth + 64);
    for (let i = 0; i < this.blocks.length; i++) {
      const rects = Array.from(this.blocks[i].getClientRects());
      if (rects.some((rect) => rect.right > pageRect.left && rect.left < pageRect.right)) {
        return { blockIndex: i, charOffset: 0 };
      }
      if (this.blocks[i].offsetLeft >= pageLeft - 8) return { blockIndex: i, charOffset: 0 };
    }
    return { blockIndex: 0, charOffset: 0 };
  }

  private goToBlock(blockIndex: number): void {
    if (!this.page) return;
    const block = this.blocks[Math.min(blockIndex, this.blocks.length - 1)];
    const pageWidth = this.page.clientWidth + 64;
    this.pageIndex = block ? Math.max(0, Math.round(block.offsetLeft / pageWidth)) : 0;
    this.applyTransform();
    this.announce();
  }

  private goToPosition(blockIndex: number, charOffset: number): void {
    this.goToBlock(blockIndex);
    if (!this.page) return;
    const block = this.blocks[Math.min(blockIndex, this.blocks.length - 1)];
    const caret = block ? collapsedRangeAt(block, charOffset) : null;
    if (!caret) return;
    const pageWidth = this.page.clientWidth + 64;
    const currentOffset = this.pageIndex * pageWidth;
    const rect = caret.getBoundingClientRect();
    const pageRect = this.page.getBoundingClientRect();
    const logicalLeft = rect.left - pageRect.left + currentOffset;
    this.pageIndex = Math.max(0, Math.min(this.pageCount - 1, Math.floor(logicalLeft / pageWidth)));
    this.applyTransform();
    this.announce();
  }

  private applyTransform(): void {
    if (!this.flow || !this.page) return;
    const offset = this.pageIndex * (this.page.clientWidth + 64);
    this.flow.style.transform = `translateX(-${offset}px)`;
  }

  private announce(): void {
    if (!this.notify) return;
    const { blockIndex, charOffset } = this.firstVisiblePosition();
    const heading = this.nearestHeading(blockIndex);
    const envelope: LocatorEnvelope = {
      v: 1,
      engine: "text",
      primary: { blockIndex, charOffset },
      textQuote: null,
      coarse: {
        sectionTitle: heading,
        blockIndex,
        pageIndex: this.pageIndex,
        progress: this.pageCount > 1 ? this.pageIndex / (this.pageCount - 1) : 1,
      },
    };
    this.notify(envelope, { sectionTitle: heading, pageIndex: this.pageIndex });
  }

  private nearestHeading(blockIndex: number): string | null {
    for (let i = blockIndex; i >= 0; i--) {
      const el = this.blocks[i];
      if (el && /^H[1-4]$/.test(el.tagName)) return el.textContent?.trim() || null;
    }
    return null;
  }

  display(locator: LocatorEnvelope | null): Promise<void> {
    if (locator?.engine === "text") {
      const resolved = this.resolveTextLocator(locator);
      this.reflow(resolved.blockIndex);
      this.goToPosition(resolved.blockIndex, resolved.charOffset);
    } else {
      this.reflow(0);
    }
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
    if (this.pageIndex < this.pageCount - 1) {
      this.pageIndex += 1;
      this.applyTransform();
      this.announce();
    }
    return Promise.resolve();
  }

  prev(): Promise<void> {
    if (this.pageIndex > 0) {
      this.pageIndex -= 1;
      this.applyTransform();
      this.announce();
    }
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
