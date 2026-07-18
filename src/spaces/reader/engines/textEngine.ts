import { marked } from "marked";
import type { ThemeName } from "../../../config/tokens";
import { stackFor, type TypographySettings } from "../../../config/typography";
import { fetchBookText } from "../../../services/bookData";
import type { LocatorEnvelope } from "../locator";
import type { EngineOpenArgs, LocatorContext, ReaderEngine } from "./types";

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
    this.resizeObserver?.disconnect();
    this.page?.remove();
    this.page = null;
    this.flow = null;
    this.blocks = [];
  }
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
