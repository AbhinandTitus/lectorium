import type { ThemeName } from "../../../config/tokens";
import type { TypographySettings } from "../../../config/typography";
import type { BookDetail } from "../../../services/types";
import type { LocatorEnvelope } from "../locator";

export interface LocatorContext {
  sectionTitle: string | null;
  pageIndex: number | null;
}

export interface EngineOpenArgs {
  container: HTMLElement;
  book: BookDetail;
  fileUrl: string;
  typography: TypographySettings;
  theme: ThemeName;
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
  locator: LocatorEnvelope;
  /** viewport rectangle of the selection for toolbar placement */
  rect: { x: number; y: number; width: number; height: number };
}

export interface EngineAnnotation {
  id: string;
  locator: LocatorEnvelope;
  colorToken: string;
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
}
