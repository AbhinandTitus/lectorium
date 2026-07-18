import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { ThemeName } from "../../../config/tokens";
import type { TypographySettings } from "../../../config/typography";
import type { LocatorEnvelope } from "../locator";
import type { EngineOpenArgs, LocatorContext, ReaderEngine } from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * PDF.js behind the ReaderEngine seam (ADR 0003). Original-page view:
 * faithful fixed layout, single paginated page, canvas rendered at DPR,
 * only current±1 pages kept warm. Scripting is disabled. In M1 the page
 * renders visually; the text layer, night recoloring, and Reflow arrive
 * in M2.
 */
export class PdfEngine implements ReaderEngine {
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private doc: PDFDocumentProxy | null = null;
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private pageIndex = 0; // zero-based
  private pageLabels: string[] | null = null;
  private notify: ((l: LocatorEnvelope, c: LocatorContext) => void) | null = null;
  private renderTask: { cancel: () => void } | null = null;
  private theme: ThemeName = "ember";

  async open(args: EngineOpenArgs): Promise<void> {
    this.container = args.container;
    this.notify = args.onLocatorChanged;
    this.theme = args.theme;

    // PDF.js v6 never executes embedded scripts unless a scripting factory
    // is supplied — we supply none.
    this.loadingTask = pdfjs.getDocument({
      url: args.fileUrl,
      disableAutoFetch: true,
      rangeChunkSize: 262144,
    });
    this.doc = await this.loadingTask.promise;
    this.pageLabels = await this.doc.getPageLabels();

    this.canvas = document.createElement("canvas");
    this.canvas.className = "pdf-page-canvas";
    this.container.appendChild(this.canvas);
  }

  private async renderCurrent(): Promise<void> {
    if (!this.doc || !this.canvas || !this.container) return;
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
      return; // cancelled by a newer render
    }
    // Ember: soften paper glare without destroying the page (a light
    // luminance filter, not inversion; full Warm Dim/Smart Dark are M2).
    this.canvas.style.filter = this.theme === "ember" ? "brightness(0.82) sepia(0.08)" : "";
    this.announce();
  }

  private announce(): void {
    if (!this.doc || !this.notify) return;
    const label = this.pageLabels?.[this.pageIndex] ?? String(this.pageIndex + 1);
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
    // Fixed layout: typography applies to Reflow view (M2), not Original.
  }

  applyTheme(theme: ThemeName): void {
    this.theme = theme;
    if (this.canvas) {
      this.canvas.style.filter = theme === "ember" ? "brightness(0.82) sepia(0.08)" : "";
    }
  }

  destroy(): void {
    this.renderTask?.cancel();
    void this.loadingTask?.destroy();
    this.loadingTask = null;
    this.doc = null;
    this.canvas?.remove();
    this.canvas = null;
  }
}
