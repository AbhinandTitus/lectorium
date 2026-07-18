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
}
