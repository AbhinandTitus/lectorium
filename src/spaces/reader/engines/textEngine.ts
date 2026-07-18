import { marked } from "marked";
import type { ThemeName } from "../../../config/tokens";
import { stackFor, type TypographySettings } from "../../../config/typography";
import { fetchBookText } from "../../../services/bookData";
import type { LocatorEnvelope } from "../locator";
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
    this.flow.innerHTML = sanitize(html);
    this.page.appendChild(this.flow);
    this.container.appendChild(this.page);

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
    if (!this.page) return 0;
    const pageLeft = this.pageIndex * (this.page.clientWidth + 64);
    for (let i = 0; i < this.blocks.length; i++) {
      if (this.blocks[i].offsetLeft >= pageLeft - 8) return i;
    }
    return 0;
  }

  private goToBlock(blockIndex: number): void {
    if (!this.page) return;
    const block = this.blocks[Math.min(blockIndex, this.blocks.length - 1)];
    const pageWidth = this.page.clientWidth + 64;
    this.pageIndex = block ? Math.max(0, Math.round(block.offsetLeft / pageWidth)) : 0;
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
    const blockIndex = this.firstVisibleBlock();
    const heading = this.nearestHeading(blockIndex);
    const envelope: LocatorEnvelope = {
      v: 1,
      engine: "text",
      primary: { blockIndex, charOffset: 0 },
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
    this.reflow(locator?.engine === "text" ? locator.primary.blockIndex : 0);
    return Promise.resolve();
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
        const start = Math.max(0, at - 40);
        hits.push({
          target: `block:${i}`,
          excerpt: `…${text.slice(start, at + needle.length + 40)}…`,
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
    const envelope: LocatorEnvelope = {
      v: 1,
      engine: "text",
      primary: { blockIndex, charOffset: 0 },
      textQuote: { exact: text, prefix: "", suffix: "" },
      coarse: { sectionTitle: this.nearestHeading(blockIndex), blockIndex },
    };
    this.selectionHandler({
      text,
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
function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, form, link, meta").forEach((el) => {
    el.remove();
  });
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  const toClean: Element[] = [];
  while (walker.nextNode()) toClean.push(walker.currentNode as Element);
  for (const el of toClean) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      if (
        (name === "href" || name === "src") &&
        (value.startsWith("javascript:") || value.startsWith("data:text"))
      ) {
        el.removeAttribute(attr.name);
      }
      // remote references are blocked by CSP as well; strip eagerly
      if ((name === "href" || name === "src") && /^https?:/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return doc.body.innerHTML;
}
