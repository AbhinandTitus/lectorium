import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { themes, type ThemeName } from "../../../config/tokens";
import { stackFor, type TypographySettings } from "../../../config/typography";
import { sentenceAroundSelection } from "../../../lib/selectionContext";
import { excerptAround, quoteContext, type LocatorEnvelope, type TextQuote } from "../locator";
import { analyzeReflow, type ReflowResult } from "./pdfReflow";
import {
  clampRect,
  imageRects,
  looksPhotographic,
  parseHexColor,
  recolorPixels,
  type PixelRect,
} from "./pdfTheme";
import type {
  BookTextSection,
  ChapterPosition,
  EngineAnnotation,
  EngineOpenArgs,
  EngineSelection,
  LocatorContext,
  PdfPresentation,
  ReaderEngine,
  SearchHit,
  TocEntry,
} from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** widest a fit-width page may grow, in CSS px, so lines stay readable */
const FIT_WIDTH_MAX_PX = 1040;
/** pages per pseudo-chapter when a PDF has no outline */
const UNOUTLINED_SPAN = 20;
const RESIZE_DEBOUNCE_MS = 160;
/** gentle dimming for original-color pages and kept photographs at night */
const NIGHT_DIM = 0.84;

interface PdfChapter {
  /** first page index (inclusive) */
  start: number;
  /** end page index (exclusive) */
  end: number;
  title: string | null;
}

/**
 * PDF.js behind the ReaderEngine seam (ADR 0003). Original-page view:
 * faithful fixed layout, one page at a time, a real text layer for
 * selection/search, only the current page kept warm. Scripting stays
 * disabled (no scripting factory is supplied).
 *
 * Each page is painted off-screen and reaches the visible canvas in one
 * step, already mapped onto the reading theme, so a white page is never
 * shown on its way to becoming a dark one.
 */
export class PdfEngine implements ReaderEngine {
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private doc: PDFDocumentProxy | null = null;
  private container: HTMLElement | null = null;
  private scroller: HTMLElement | null = null;
  private pageWrap: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private textLayerDiv: HTMLElement | null = null;
  private pageIndex = 0; // zero-based
  private pageLabels: string[] | null = null;
  private notify: ((l: LocatorEnvelope, c: LocatorContext) => void) | null = null;
  private selectionHandler: ((sel: EngineSelection | null) => void) | null = null;
  private renderTask: { cancel: () => void } | null = null;
  private renderToken = 0;
  private theme: ThemeName = "ember";
  private presentation: PdfPresentation = { colors: "themed", fit: "page" };
  private highlights: EngineAnnotation[] = [];
  private selectionListener: (() => void) | null = null;
  private viewMode: "original" | "reflow" = "original";
  private reflow: ReflowResult | null = null;
  private reflowContainer: HTMLElement | null = null;
  private typography: TypographySettings | null = null;
  private language: string | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: number | null = null;
  private lastBox = { width: 0, height: 0 };
  private chapters: PdfChapter[] = [];
  /** running estimate of text characters per page, from pages seen */
  private charsSeen = 0;
  private pagesSeen = new Set<number>();

  async open(args: EngineOpenArgs): Promise<void> {
    this.container = args.container;
    this.notify = args.onLocatorChanged;
    this.theme = args.theme;
    this.presentation = args.pdf;
    this.typography = args.typography;
    this.language = args.book.language;

    this.loadingTask = pdfjs.getDocument({
      url: args.fileUrl,
      disableAutoFetch: true,
      rangeChunkSize: 262144,
    });
    this.doc = await this.loadingTask.promise;
    this.pageLabels = await this.doc.getPageLabels();
    await this.buildChapters();

    this.scroller = document.createElement("div");
    this.scroller.className = "pdf-scroll";
    this.pageWrap = document.createElement("div");
    this.pageWrap.className = "pdf-page-wrap";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "pdf-page-canvas";
    this.textLayerDiv = document.createElement("div");
    this.textLayerDiv.className = "textLayer pdf-text-layer";
    this.pageWrap.append(this.canvas, this.textLayerDiv);
    this.scroller.appendChild(this.pageWrap);
    this.container.appendChild(this.scroller);
    this.applyFitClass();

    this.selectionListener = () => this.emitSelection();
    document.addEventListener("selectionchange", this.selectionListener);

    // A page is painted for one box size; when the window, full screen or
    // display scaling changes, paint it again for the new one.
    this.lastBox = { width: this.container.clientWidth, height: this.container.clientHeight };
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        const el = this.container;
        if (!el || this.viewMode !== "original") return;
        if (el.clientWidth === this.lastBox.width && el.clientHeight === this.lastBox.height) {
          return;
        }
        this.lastBox = { width: el.clientWidth, height: el.clientHeight };
        void this.renderCurrent();
      }, RESIZE_DEBOUNCE_MS);
    });
    this.resizeObserver.observe(this.container);
  }

  private applyFitClass(): void {
    this.scroller?.classList.toggle("is-fit-width", this.presentation.fit === "width");
  }

  private emitSelection(): void {
    if (!this.selectionHandler || !this.textLayerDiv) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !this.textLayerDiv.contains(sel.anchorNode)) {
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
    const pageRect = this.pageWrap!.getBoundingClientRect();
    const before = range.cloneRange();
    before.selectNodeContents(this.textLayerDiv);
    before.setEnd(range.startContainer, range.startOffset);
    const fullText = this.textLayerDiv.textContent ?? "";
    const startOffset = before.toString().length;
    const quote: TextQuote = quoteContext(fullText, startOffset, startOffset + text.length);
    const envelope: LocatorEnvelope = {
      v: 1,
      engine: "pdf",
      primary: {
        pageIndex: this.pageIndex,
        pageLabel: this.label(),
        x: Math.min(1, Math.max(0, (rect.x - pageRect.x) / Math.max(1, pageRect.width))),
        y: Math.min(1, Math.max(0, (rect.y - pageRect.y) / Math.max(1, pageRect.height))),
      },
      textQuote: quote,
      coarse: {
        sectionTitle: this.chapterFor(this.pageIndex)?.title ?? null,
        pageIndex: this.pageIndex,
      },
    };
    this.selectionHandler({
      text,
      context: sentenceAroundSelection(
        fullText.slice(0, startOffset),
        text,
        fullText.slice(startOffset + text.length),
      ),
      locator: envelope,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  }

  private label(index = this.pageIndex): string {
    return this.pageLabels?.[index] ?? String(index + 1);
  }

  /** CSS scale for the current fit mode and box. */
  private scaleFor(pageWidth: number, pageHeight: number): number {
    const container = this.container;
    if (!container) return 1;
    const availW = Math.max(120, container.clientWidth - 32);
    const availH = Math.max(120, container.clientHeight - 24);
    if (this.presentation.fit === "width") {
      return Math.min(availW, FIT_WIDTH_MAX_PX) / pageWidth;
    }
    return Math.min(availW / pageWidth, availH / pageHeight);
  }

  private async renderCurrent(): Promise<void> {
    const doc = this.doc;
    if (!doc || !this.canvas || !this.container || !this.textLayerDiv) return;
    const token = ++this.renderToken;
    const index = this.pageIndex;
    this.renderTask?.cancel();
    this.renderTask = null;

    let page: PDFPageProxy;
    try {
      page = await doc.getPage(index + 1);
    } catch {
      return;
    }
    // A newer request (a faster page turn, a resize) owns the canvas now.
    if (token !== this.renderToken || !this.canvas) return;

    const raw = page.getViewport({ scale: 1 });
    const scale = this.scaleFor(raw.width, raw.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.floor(viewport.width * dpr));
    const height = Math.max(1, Math.floor(viewport.height * dpr));

    const buffer = document.createElement("canvas");
    buffer.width = width;
    buffer.height = height;
    const task = page.render({
      canvas: buffer,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    });
    this.renderTask = task;
    try {
      await task.promise;
    } catch {
      return; // superseded by a newer render
    }
    if (token !== this.renderToken || !this.canvas || !this.textLayerDiv) return;

    const photos = await this.photoRects(page, viewport.transform, dpr, width, height);
    if (token !== this.renderToken || !this.canvas || !this.textLayerDiv) return;
    this.present(buffer, photos);

    this.canvas.style.width = `${Math.floor(viewport.width)}px`;
    this.canvas.style.height = `${Math.floor(viewport.height)}px`;
    if (this.scroller) this.scroller.scrollTop = 0;

    // real selectable text over the canvas
    this.textLayerDiv.replaceChildren();
    this.textLayerDiv.style.width = this.canvas.style.width;
    this.textLayerDiv.style.height = this.canvas.style.height;
    // PDF.js sizes text-layer glyphs from this custom property
    this.pageWrap?.style.setProperty("--scale-factor", String(scale));
    this.pageWrap?.style.setProperty("--total-scale-factor", String(scale));
    try {
      const textLayer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container: this.textLayerDiv,
        viewport,
      });
      await textLayer.render();
    } catch {
      // image-only or broken-encoding page: visual reading still works
    }
    if (token !== this.renderToken) return;

    if (!this.pagesSeen.has(index)) {
      this.pagesSeen.add(index);
      this.charsSeen += (this.textLayerDiv.textContent ?? "").length;
    }
    this.paintHighlights();
    this.announce();
  }

  /** Where the photographs are on this page, in buffer pixels. */
  private async photoRects(
    page: PDFPageProxy,
    viewportTransform: number[],
    dpr: number,
    width: number,
    height: number,
  ): Promise<PixelRect[]> {
    if (this.presentation.colors !== "themed") return [];
    try {
      const list = await page.getOperatorList();
      return imageRects(list.fnArray, list.argsArray, pdfjs.OPS, viewportTransform, dpr)
        .map((rect) => clampRect(rect, width, height))
        .filter((rect): rect is PixelRect => rect !== null);
    } catch {
      return []; // theming still applies to the whole page
    }
  }

  /** Move the painted page to the screen in one step, in theme. */
  private present(buffer: HTMLCanvasElement, photos: PixelRect[]): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const night = this.theme === "ember";
    const source = buffer.getContext("2d", { willReadFrequently: true });
    canvas.width = buffer.width;
    canvas.height = buffer.height;
    const out = canvas.getContext("2d");
    if (!source || !out) return;

    if (this.presentation.colors !== "themed") {
      out.filter = night ? `brightness(${NIGHT_DIM}) sepia(0.08)` : "none";
      out.drawImage(buffer, 0, 0);
      out.filter = "none";
      canvas.style.filter = "";
      return;
    }

    let image: ImageData;
    try {
      image = source.getImageData(0, 0, buffer.width, buffer.height);
    } catch {
      out.drawImage(buffer, 0, 0);
      return;
    }
    const kept = photos.filter((rect) => looksPhotographic(image.data, buffer.width, rect));
    const palette = themes[this.theme];
    recolorPixels(image.data, parseHexColor(palette.textPrimary), parseHexColor(palette.page));
    out.putImageData(image, 0, 0);
    // photographs go back as they were (a luminance map would invert them)
    out.filter = night ? `brightness(${NIGHT_DIM})` : "none";
    for (const rect of kept) {
      out.drawImage(
        buffer,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
      );
    }
    out.filter = "none";
    canvas.style.filter = "";
  }

  /** CSS Custom Highlight API over text-layer ranges — no DOM mutation. */
  private paintHighlights(): void {
    if (!("highlights" in CSS) || !this.textLayerDiv) return;
    const ranges: Range[] = [];
    for (const a of this.highlights) {
      if (a.locator.engine !== "pdf" || a.locator.primary.pageIndex !== this.pageIndex) continue;
      const exact = a.locator.textQuote?.exact;
      if (!exact) continue;
      const range = findTextRange(this.textLayerDiv, exact);
      if (range) ranges.push(range);
    }
    if (ranges.length > 0) {
      CSS.highlights.set("lectorium-pdf", new Highlight(...ranges));
    } else {
      CSS.highlights.delete("lectorium-pdf");
    }
  }

  // ---- chapters ----

  private async buildChapters(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const starts = new Map<number, string>();
    try {
      for (const entry of await this.toc()) {
        const m = /^page:(\d+)$/.exec(entry.target);
        if (!m || entry.depth > 1) continue;
        const page = Number(m[1]);
        if (!starts.has(page)) starts.set(page, entry.label.trim());
      }
    } catch {
      // no usable outline
    }
    const chapters: PdfChapter[] = [];
    if (starts.size >= 2) {
      const pages = [...starts.keys()].sort((a, b) => a - b);
      if (pages[0] > 0) chapters.push({ start: 0, end: pages[0], title: null });
      pages.forEach((page, i) => {
        chapters.push({
          start: page,
          end: pages[i + 1] ?? doc.numPages,
          title: starts.get(page) ?? null,
        });
      });
    } else {
      // No outline: even spans keep targets and summaries a readable size.
      for (let start = 0; start < doc.numPages; start += UNOUTLINED_SPAN) {
        const end = Math.min(doc.numPages, start + UNOUTLINED_SPAN);
        chapters.push({
          start,
          end,
          title:
            doc.numPages <= UNOUTLINED_SPAN
              ? null
              : `Pages ${this.label(start)}–${this.label(end - 1)}`,
        });
      }
    }
    this.chapters = chapters;
  }

  private chapterFor(pageIndex: number): PdfChapter | null {
    return this.chapters.find((c) => pageIndex >= c.start && pageIndex < c.end) ?? null;
  }

  private chapterPosition(pageIndex: number): ChapterPosition | null {
    const doc = this.doc;
    const chapter = this.chapterFor(pageIndex);
    if (!doc || !chapter) return null;
    const perPage = this.pagesSeen.size > 0 ? this.charsSeen / this.pagesSeen.size : null;
    const pages = chapter.end - chapter.start;
    const pagesLeft = chapter.end - pageIndex;
    return {
      index: this.chapters.indexOf(chapter),
      total: this.chapters.length,
      title: chapter.title,
      fraction: pages > 0 ? (pageIndex - chapter.start) / pages : 0,
      chars: perPage === null ? null : Math.round(perPage * pages),
      charsLeft: perPage === null ? null : Math.round(perPage * pagesLeft),
      bookCharsLeft: perPage === null ? null : Math.round(perPage * (doc.numPages - pageIndex)),
    };
  }

  private envelopeFor(pageIndex: number): LocatorEnvelope {
    const numPages = this.doc?.numPages ?? 1;
    return {
      v: 1,
      engine: "pdf",
      primary: { pageIndex, pageLabel: this.label(pageIndex), x: 0, y: 0 },
      textQuote: null,
      coarse: {
        sectionTitle: this.chapterFor(pageIndex)?.title ?? null,
        pageIndex,
        progress: (pageIndex + 1) / numPages,
      },
    };
  }

  private announce(): void {
    if (!this.doc || !this.notify) return;
    this.notify(this.envelopeFor(this.pageIndex), {
      sectionTitle: `Page ${this.label()}`,
      pageIndex: this.pageIndex,
      chapter: this.chapterPosition(this.pageIndex),
    });
  }

  async display(locator: LocatorEnvelope | null): Promise<void> {
    if (!this.doc) return;
    if (locator && locator.engine === "pdf") {
      this.pageIndex = Math.min(Math.max(0, locator.primary.pageIndex), this.doc.numPages - 1);
    } else {
      this.pageIndex = 0;
    }
    if (this.viewMode === "reflow") {
      this.scrollReflowToPage();
    } else {
      await this.renderCurrent();
    }
  }

  /** In fit-width, a wheel gesture belongs to the page until it hits an edge. */
  consumesWheel(deltaY: number): boolean {
    if (this.viewMode !== "original" || this.presentation.fit !== "width") return false;
    const el = this.scroller;
    if (!el || el.scrollHeight <= el.clientHeight + 2) return false;
    return deltaY > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 2 : el.scrollTop > 2;
  }

  /** Scroll within a fit-width page; false when already at that edge. */
  private scrollWithinPage(direction: 1 | -1): boolean {
    const el = this.scroller;
    if (!el || this.presentation.fit !== "width") return false;
    if (!this.consumesWheel(direction)) return false;
    el.scrollBy({ top: direction * el.clientHeight * 0.88 });
    return true;
  }

  async next(): Promise<void> {
    if (this.viewMode === "reflow") {
      this.reflowContainer?.scrollBy({ top: this.reflowContainer.clientHeight * 0.9 });
      return;
    }
    if (this.scrollWithinPage(1)) return;
    if (!this.doc || this.pageIndex >= this.doc.numPages - 1) return;
    this.pageIndex += 1;
    await this.renderCurrent();
  }

  async prev(): Promise<void> {
    if (this.viewMode === "reflow") {
      this.reflowContainer?.scrollBy({ top: -this.reflowContainer.clientHeight * 0.9 });
      return;
    }
    if (this.scrollWithinPage(-1)) return;
    if (this.pageIndex <= 0) return;
    this.pageIndex -= 1;
    await this.renderCurrent();
    // arriving from the page after, continue from the foot of this one
    if (this.presentation.fit === "width" && this.scroller) {
      this.scroller.scrollTop = this.scroller.scrollHeight;
    }
  }

  applyPdfPresentation(presentation: PdfPresentation): void {
    const changed =
      presentation.colors !== this.presentation.colors ||
      presentation.fit !== this.presentation.fit;
    this.presentation = presentation;
    this.applyFitClass();
    if (changed && this.viewMode === "original") void this.renderCurrent();
  }

  // ---- Reflow (derived view; never modifies the file — ADR 0003) ----

  /** Analyze once and cache; the shell reads confidence to warn the user. */
  async getReflow(): Promise<ReflowResult | null> {
    if (!this.doc) return null;
    this.reflow ??= await analyzeReflow(this.doc);
    return this.reflow;
  }

  async setViewMode(mode: "original" | "reflow"): Promise<void> {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    if (mode === "reflow") {
      await this.renderReflow();
    } else {
      this.reflowContainer?.remove();
      this.reflowContainer = null;
      if (this.scroller) this.scroller.style.display = "";
      await this.renderCurrent();
    }
  }

  getViewMode(): "original" | "reflow" {
    return this.viewMode;
  }

  private async renderReflow(): Promise<void> {
    const result = await this.getReflow();
    if (!result || !this.container) return;
    if (this.scroller) this.scroller.style.display = "none";
    this.reflowContainer?.remove();

    const wrap = document.createElement("div");
    wrap.className = "pdf-reflow";
    if (this.typography) {
      wrap.style.maxWidth = `${Math.round(this.typography.maxWidthCh * 0.53 * this.typography.fontSizePx)}px`;
      wrap.style.fontFamily = stackFor(this.language);
      wrap.style.fontSize = `${this.typography.fontSizePx}px`;
      wrap.style.lineHeight = String(this.typography.lineHeight);
    }
    for (const block of result.blocks) {
      const el = document.createElement(block.kind === "heading" ? "h2" : "p");
      el.textContent = block.text;
      el.dataset.pageIndex = String(block.pageIndex);
      wrap.appendChild(el);
    }
    this.container.appendChild(wrap);
    this.reflowContainer = wrap;

    // report the current page as the reader scrolls (cross-view locator)
    wrap.addEventListener("scroll", () => this.reportReflowPage(), { passive: true });
    this.scrollReflowToPage();
    this.reportReflowPage();
  }

  private scrollReflowToPage(): void {
    const wrap = this.reflowContainer;
    if (!wrap) return;
    const target = wrap.querySelector<HTMLElement>(`[data-page-index="${this.pageIndex}"]`);
    if (target) wrap.scrollTop = target.offsetTop - 16;
  }

  private reportReflowPage(): void {
    const wrap = this.reflowContainer;
    if (!wrap || !this.notify || !this.doc) return;
    const blocks = Array.from(wrap.querySelectorAll<HTMLElement>("[data-page-index]"));
    const top = wrap.scrollTop + 8;
    let pageIndex = this.pageIndex;
    for (const b of blocks) {
      if (b.offsetTop <= top) pageIndex = Number(b.dataset.pageIndex);
      else break;
    }
    this.pageIndex = pageIndex;
    this.notify(this.envelopeFor(pageIndex), {
      sectionTitle: `Page ${this.label()} · Reflow`,
      pageIndex,
      chapter: this.chapterPosition(pageIndex),
    });
  }

  applyTypography(t: TypographySettings): void {
    this.typography = t;
    const wrap = this.reflowContainer;
    if (wrap) {
      wrap.style.maxWidth = `${Math.round(t.maxWidthCh * 0.53 * t.fontSizePx)}px`;
      wrap.style.fontSize = `${t.fontSizePx}px`;
      wrap.style.lineHeight = String(t.lineHeight);
    }
    // Original fixed layout ignores typography by design.
  }

  applyTheme(theme: ThemeName): void {
    if (theme === this.theme) return;
    this.theme = theme;
    // the page is painted in theme, so a theme change repaints it
    if (this.viewMode === "original") void this.renderCurrent();
  }

  destroy(): void {
    if (this.selectionListener) {
      document.removeEventListener("selectionchange", this.selectionListener);
    }
    if ("highlights" in CSS) CSS.highlights.delete("lectorium-pdf");
    this.renderToken += 1;
    if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.renderTask?.cancel();
    void this.loadingTask?.destroy();
    this.loadingTask = null;
    this.doc = null;
    this.scroller?.remove();
    this.scroller = null;
    this.pageWrap = null;
    this.reflowContainer?.remove();
    this.reflowContainer = null;
    this.canvas = null;
    this.textLayerDiv = null;
  }

  async toc(): Promise<TocEntry[]> {
    if (!this.doc) return [];
    const outline = await this.doc.getOutline();
    if (!outline) return [];
    const out: TocEntry[] = [];
    const walk = async (
      items: { title: string; dest: unknown; items?: unknown[] }[],
      depth: number,
    ) => {
      for (const item of items) {
        const pageIndex = await this.resolveDest(item.dest);
        if (pageIndex !== null) {
          out.push({ label: item.title, target: `page:${pageIndex}`, depth });
        }
        if (Array.isArray(item.items) && item.items.length > 0) {
          await walk(item.items as { title: string; dest: unknown }[], depth + 1);
        }
      }
    };
    await walk(outline, 0);
    return out;
  }

  private async resolveDest(dest: unknown): Promise<number | null> {
    if (!this.doc) return null;
    try {
      const explicit = typeof dest === "string" ? await this.doc.getDestination(dest) : dest;
      if (Array.isArray(explicit) && explicit[0]) {
        return await this.doc.getPageIndex(
          explicit[0] as Parameters<PDFDocumentProxy["getPageIndex"]>[0],
        );
      }
    } catch {
      /* unresolvable destination */
    }
    return null;
  }

  async goTo(target: string): Promise<void> {
    const m = /^page:(\d+)$/.exec(target);
    if (!m || !this.doc) return;
    this.pageIndex = Math.min(Math.max(0, Number(m[1])), this.doc.numPages - 1);
    await this.renderCurrent();
  }

  async search(query: string): Promise<SearchHit[]> {
    if (!this.doc || query.trim().length < 2) return [];
    const needle = query.toLowerCase();
    const hits: SearchHit[] = [];
    for (let i = 0; i < this.doc.numPages && hits.length < 200; i++) {
      const page = await this.doc.getPage(i + 1);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => ("str" in it ? it.str : ""))
        .join(" ")
        .replace(/\s+/g, " ");
      const lower = text.toLowerCase();
      let from = 0;
      let at = lower.indexOf(needle, from);
      while (at !== -1 && hits.length < 200) {
        hits.push({
          target: `page:${i}`,
          excerpt: excerptAround(text, at, needle.length),
          sectionTitle: `Page ${this.pageLabels?.[i] ?? i + 1}`,
        });
        from = at + needle.length;
        at = lower.indexOf(needle, from);
      }
    }
    return hits;
  }

  /** Plain text by chapter (outline sections, or even spans without one). */
  async extractText(): Promise<BookTextSection[]> {
    const doc = this.doc;
    if (!doc) return [];
    const out: BookTextSection[] = [];
    for (let c = 0; c < this.chapters.length; c++) {
      const chapter = this.chapters[c];
      const parts: string[] = [];
      for (let i = chapter.start; i < chapter.end; i++) {
        if (this.doc !== doc) return [];
        try {
          const page = await doc.getPage(i + 1);
          const content = await page.getTextContent();
          let text = "";
          for (const item of content.items) {
            if (!("str" in item)) continue;
            text += item.str;
            text += item.hasEOL ? "\n" : " ";
          }
          const clean = text.replace(/[ \t]+/g, " ").trim();
          if (clean) parts.push(clean);
        } catch {
          // an unreadable page contributes nothing
        }
      }
      out.push({ index: c, title: chapter.title, text: parts.join("\n") });
    }
    return out;
  }

  onSelection(handler: (sel: EngineSelection | null) => void): void {
    this.selectionHandler = handler;
  }

  setHighlights(annotations: EngineAnnotation[]): void {
    this.highlights = annotations;
    this.paintHighlights();
  }
}

/** Find the first Range matching `exact` across text-layer span boundaries. */
function findTextRange(root: HTMLElement, exact: string): Range | null {
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
