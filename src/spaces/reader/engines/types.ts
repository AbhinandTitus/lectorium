import type { ThemeName } from "../../../config/tokens";
import type { TypographySettings } from "../../../config/typography";
import type { BookDetail } from "../../../services/types";
import type { LocatorEnvelope } from "../locator";

/**
 * Where the reader is inside the current chapter. Transient UI context for
 * the session target and "time left" — never stored as a position.
 */
export interface ChapterPosition {
  /** ordinal of the chapter in reading order */
  index: number;
  /** number of chapters the engine knows about */
  total: number;
  title: string | null;
  /** 0..1 through the chapter */
  fraction: number;
  /** characters of text in the chapter, when the engine can count them */
  chars: number | null;
  /** characters between the top of this page and the chapter's end */
  charsLeft: number | null;
  /** characters between the top of this page and the end of the book */
  bookCharsLeft: number | null;
}

export interface LocatorContext {
  sectionTitle: string | null;
  pageIndex: number | null;
  chapter?: ChapterPosition | null;
}

/** A chapter's plain text, for local indexing by the optional companion. */
export interface BookTextSection {
  /** matches ChapterPosition.index */
  index: number;
  title: string | null;
  text: string;
}

/** How fixed-layout PDF pages are presented. */
export interface PdfPresentation {
  /** "themed" maps the page onto the reading theme; "original" leaves it */
  colors: "themed" | "original";
  /** whole page visible, or page width filled and scrolled */
  fit: "page" | "width";
}

export interface EngineOpenArgs {
  container: HTMLElement;
  book: BookDetail;
  fileUrl: string;
  typography: TypographySettings;
  theme: ThemeName;
  publisherStyles: boolean;
  pdf: PdfPresentation;
  /** called on every settle so the shell can autosave */
  onLocatorChanged: (locator: LocatorEnvelope, context: LocatorContext) => void;
}

export interface TocEntry {
  label: string;
  /** engine-native target resolvable by goTo() */
  target: string;
  depth: number;
}

export interface SearchHit {
  /** engine-native target resolvable by goTo() */
  target: string;
  excerpt: string;
  sectionTitle: string | null;
}

/** A selection the user made in book content. */
export interface EngineSelection {
  text: string;
  /** complete surrounding sentence when the engine can recover it */
  context: string;
  locator: LocatorEnvelope;
  /** viewport rectangle of the selection for toolbar placement */
  rect: { x: number; y: number; width: number; height: number };
}

export interface EngineAnnotation {
  id: string;
  locator: LocatorEnvelope;
  colorToken: string;
}

export interface EngineKeyInput {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * The seam between the product and any rendering library (ADR 0002/0003).
 * Nothing outside `engines/` may import epub.js or PDF.js types.
 */
export interface ReaderEngine {
  open(args: EngineOpenArgs): Promise<void>;
  /** show a stored location; null means the beginning */
  display(locator: LocatorEnvelope | null): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  applyTypography(t: TypographySettings): void;
  applyTheme(theme: ThemeName): void;
  destroy(): void;

  /** table of contents; empty when the format has none */
  toc(): Promise<TocEntry[]>;
  /** jump to a TOC/search target */
  goTo(target: string): Promise<void>;
  /** full-book text search (may be slow; caller debounces) */
  search(query: string): Promise<SearchHit[]>;
  /** current selection callback registration; fires with null when cleared */
  onSelection(handler: (sel: EngineSelection | null) => void): void;
  /** paint stored highlights; called after open and after each render */
  setHighlights(annotations: EngineAnnotation[]): void;
  /** footnote reference activated (EPUB); no-op elsewhere */
  onFootnote?(handler: (note: { text: string; rect: DOMRect }) => void): void;
  /**
   * Register a wheel-to-flip forwarder. Needed for engines whose content
   * lives in an iframe (EPUB), where wheel events never reach the host DOM.
   * The handler receives the raw wheel deltaY; the caller throttles.
   */
  onWheel?(handler: (deltaY: number) => void): void;
  /** forward keys from an iframe-backed reading surface; true means consumed */
  onKeyDown?(handler: (event: EngineKeyInput) => boolean): void;
  /** pointer activity inside an iframe should wake the shell's faded controls */
  onActivity?(handler: () => void): void;
  /** external URL activated; the shell owns confirmation and system opening */
  onExternalLink?(handler: (url: string) => void): void;
  /** switch EPUB between Lectorium's reader style and publisher CSS */
  applyPublisherStyles?(enabled: boolean): void;
  /**
   * Plain text by chapter, in reading order. Read locally; only the
   * opt-in companion ever asks for it.
   */
  extractText?(): Promise<BookTextSection[]>;

  // --- PDF-only presentation controls (undefined on other engines) ---
  applyPdfPresentation?(presentation: PdfPresentation): void;
  /** true when a wheel gesture should scroll inside the page, not turn it */
  consumesWheel?(deltaY: number): boolean;
  /** analyze suitability for the reversible Reflow view */
  getReflow?(): Promise<{
    confidence: "high" | "low";
    reason: string | null;
    textUnavailable: boolean;
    truncated: boolean;
    blocks: unknown[];
  } | null>;
  setViewMode?(mode: "original" | "reflow"): Promise<void>;
  getViewMode?(): "original" | "reflow";
}
