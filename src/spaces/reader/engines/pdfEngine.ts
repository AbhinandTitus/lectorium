import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { ThemeName } from "../../../config/tokens";
import type { TypographySettings } from "../../../config/typography";
import type { LocatorEnvelope, TextQuote } from "../locator";
import type {
  EngineAnnotation,
  EngineOpenArgs,
  EngineSelection,
  LocatorContext,
  ReaderEngine,
  SearchHit,
  TocEntry,
} from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * PDF.js behind the ReaderEngine seam (ADR 0003). Original-page view:
 * faithful fixed layout, single paginated page, canvas at DPR, a real
 * text layer for selection/search, only the current page kept warm.
 * Scripting stays disabled (no scripting factory is supplied).
 */
export class PdfEngine implements ReaderEngine {
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private doc: PDFDocumentProxy | null = null;
  private container: HTMLElement | null = null;
  private pageWrap: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private textLayerDiv: HTMLElement | null = null;
  private pageIndex = 0; // zero-based
  private pageLabels: string[] | null = null;
  private notify: ((l: LocatorEnvelope, c: LocatorContext) => void) | null = null;
  private selectionHandler: ((sel: EngineSelection | null) => void) | null = null;
  private renderTask: { cancel: () => void } | null = null;
  private theme: ThemeName = "ember";
  private highlights: EngineAnnotation[] = [];
  private selectionListener: (() => void) | null = null;

  async open(args: EngineOpenArgs): Promise<void> {
    this.container = args.container;
    this.notify = args.onLocatorChanged;
    this.theme = args.theme;

    this.loadingTask = pdfjs.getDocument({
      url: args.fileUrl,
      disableAutoFetch: true,
      rangeChunkSize: 262144,
    });
    this.doc = await this.loadingTask.promise;
    this.pageLabels = await this.doc.getPageLabels();

    this.pageWrap = document.createElement("div");
    this.pageWrap.className = "pdf-page-wrap";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "pdf-page-canvas";
    this.textLayerDiv = document.createElement("div");
    this.textLayerDiv.className = "textLayer pdf-text-layer";
    this.pageWrap.append(this.canvas, this.textLayerDiv);
    this.container.appendChild(this.pageWrap);

    this.selectionListener = () => this.emitSelection();
    document.addEventListener("selectionchange", this.selectionListener);
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
    const quote: TextQuote = { exact: text, prefix: "", suffix: "" };
    const envelope: LocatorEnvelope = {
      v: 1,
      engine: "pdf",
      primary: {
        pageIndex: this.pageIndex,
        pageLabel: this.label(),
        x: (rect.x - pageRect.x) / Math.max(1, pageRect.width),
        y: (rect.y - pageRect.y) / Math.max(1, pageRect.height),
      },
      textQuote: quote,
      coarse: { sectionTitle: null, pageIndex: this.pageIndex },
    };
    this.selectionHandler({
      text,
      locator: envelope,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  }

  private label(): string {
    return this.pageLabels?.[this.pageIndex] ?? String(this.pageIndex + 1);
  }

  private async renderCurrent(): Promise<void> {
    if (!this.doc || !this.canvas || !this.container || !this.textLayerDiv) return;
    const page: PDFPageProxy = await this.doc.getPage(this.pageIndex + 1);

    const viewportRaw = page.getViewport({ scale: 1 });
    const availW = this.container.clientWidth - 32;
    const availH = this.container.clientHeight - 24;
    const scale = Math.min(availW / viewportRaw.width, availH / viewportRaw.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const viewport = page.getViewport({ scale });

    this.canvas.width = Math.floor(viewport.width * dpr);
    this.canvas.height = Math.floor(viewport.height * dpr);
    this.canvas.style.width = `${Math.floor(viewport.width)}px`;
    this.canvas.style.height = `${Math.floor(viewport.height)}px`;

    this.renderTask?.cancel();
    const task = page.render({
      canvas: this.canvas,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    });
    this.renderTask = task;
    try {
      await task.promise;
    } catch {
      return; // superseded by a newer render
    }

    // real selectable text over the canvas
    this.textLayerDiv.replaceChildren();
    this.textLayerDiv.style.width = this.canvas.style.width;
    this.textLayerDiv.style.height = this.canvas.style.height;
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

    this.canvas.style.filter = this.theme === "ember" ? "brightness(0.82) sepia(0.08)" : "";
    this.paintHighlights();
    this.announce();
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

  private announce(): void {
    if (!this.doc || !this.notify) return;
    const label = this.label();
    const envelope: LocatorEnvelope = {
      v: 1,
      engine: "pdf",
      primary: { pageIndex: this.pageIndex, pageLabel: label, x: 0, y: 0 },
      textQuote: null,
      coarse: {
        sectionTitle: null,
        pageIndex: this.pageIndex,
        progress: (this.pageIndex + 1) / this.doc.numPages,
      },
    };
    this.notify(envelope, { sectionTitle: `Page ${label}`, pageIndex: this.pageIndex });
  }

  async display(locator: LocatorEnvelope | null): Promise<void> {
    if (!this.doc) return;
    if (locator && locator.engine === "pdf") {
      this.pageIndex = Math.min(Math.max(0, locator.primary.pageIndex), this.doc.numPages - 1);
    } else {
      this.pageIndex = 0;
    }
    await this.renderCurrent();
  }

  async next(): Promise<void> {
    if (!this.doc || this.pageIndex >= this.doc.numPages - 1) return;
    this.pageIndex += 1;
    await this.renderCurrent();
  }

  async prev(): Promise<void> {
    if (this.pageIndex <= 0) return;
    this.pageIndex -= 1;
    await this.renderCurrent();
  }

  applyTypography(_t: TypographySettings): void {
    // Fixed layout: typography applies to the Reflow view, not Original.
  }

  applyTheme(theme: ThemeName): void {
    this.theme = theme;
    if (this.canvas) {
      this.canvas.style.filter = theme === "ember" ? "brightness(0.82) sepia(0.08)" : "";
    }
  }

  destroy(): void {
    if (this.selectionListener) {
      document.removeEventListener("selectionchange", this.selectionListener);
    }
    if ("highlights" in CSS) CSS.highlights.delete("lectorium-pdf");
    this.renderTask?.cancel();
    void this.loadingTask?.destroy();
    this.loadingTask = null;
    this.doc = null;
    this.pageWrap?.remove();
    this.pageWrap = null;
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
        const start = Math.max(0, at - 40);
        const end = Math.min(text.length, at + needle.length + 40);
        hits.push({
          target: `page:${i}`,
          excerpt: `…${text.slice(start, end)}…`,
          sectionTitle: `Page ${this.pageLabels?.[i] ?? i + 1}`,
        });
        from = at + needle.length;
        at = lower.indexOf(needle, from);
      }
    }
    return hits;
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
