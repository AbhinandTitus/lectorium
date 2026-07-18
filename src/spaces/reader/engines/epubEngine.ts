import ePub, { Book, Contents, Rendition } from "epubjs";
import type { ThemeName } from "../../../config/tokens";
import { themes } from "../../../config/tokens";
import { stackFor, type TypographySettings } from "../../../config/typography";
import { fetchBookBytes } from "../../../services/bookData";
import type { LocatorEnvelope } from "../locator";
import type { EngineOpenArgs, ReaderEngine } from "./types";

interface RelocatedLocation {
  start: {
    cfi: string;
    href: string;
    index: number;
    percentage?: number;
  };
}

/**
 * epub.js behind the ReaderEngine seam (ADR 0002). Publication scripts are
 * disabled; chapters render inside epub.js's sandboxed iframes.
 */
export class EpubEngine implements ReaderEngine {
  private book: Book | null = null;
  private rendition: Rendition | null = null;
  private language: string | null = null;
  private typography: TypographySettings | null = null;
  private theme: ThemeName = "ember";

  async open(args: EngineOpenArgs): Promise<void> {
    const bytes = await fetchBookBytes(args.fileUrl);
    this.language = args.book.language;
    this.book = ePub(bytes);
    const book = this.book;

    this.rendition = book.renderTo(args.container, {
      width: "100%",
      height: "100%",
      flow: "paginated",
      spread: "none",
      allowScriptedContent: false,
    });

    // bundled fonts (incl. Malayalam) must exist inside each chapter iframe
    this.rendition.hooks.content.register((contents: Contents) =>
      contents.addStylesheet(`${window.location.origin}/reader-fonts.css`),
    );

    this.applyTypography(args.typography);
    this.applyTheme(args.theme);

    this.rendition.on("relocated", (location: RelocatedLocation) => {
      void (async () => {
        const sectionTitle = await this.sectionTitle(location.start.href);
        const envelope: LocatorEnvelope = {
          v: 1,
          engine: "epub",
          primary: {
            cfi: location.start.cfi,
            spineIndex: location.start.index,
            href: location.start.href,
          },
          textQuote: null, // captured by annotation flows from M2
          coarse: {
            sectionTitle,
            spineIndex: location.start.index,
            progress: location.start.percentage,
          },
        };
        args.onLocatorChanged(envelope, { sectionTitle, pageIndex: null });
      })();
    });
  }

  private async sectionTitle(href: string): Promise<string | null> {
    try {
      const nav = await this.book?.loaded.navigation;
      const item = nav?.get(href);
      return item?.label?.trim() || null;
    } catch {
      return null;
    }
  }

  async display(locator: LocatorEnvelope | null): Promise<void> {
    if (!this.rendition) return;
    if (locator && locator.engine === "epub") {
      try {
        await this.rendition.display(locator.primary.cfi);
        return;
      } catch {
        // fall through to coarse anchor — never jump to a rounded percentage
        if (typeof locator.coarse.spineIndex === "number") {
          await this.rendition.display(locator.coarse.spineIndex);
          return;
        }
      }
    }
    await this.rendition.display();
  }

  async next(): Promise<void> {
    await this.rendition?.next();
  }

  async prev(): Promise<void> {
    await this.rendition?.prev();
  }

  applyTypography(t: TypographySettings): void {
    this.typography = t;
    this.injectContentStyles();
  }

  applyTheme(theme: ThemeName): void {
    this.theme = theme;
    this.injectContentStyles();
  }

  /** One combined rule set — epub.js replaces the default theme wholesale. */
  private injectContentStyles(): void {
    if (!this.rendition || !this.typography) return;
    const t = this.typography;
    const palette = themes[this.theme];
    const family = this.language ? stackFor(this.language) : t.fontFamily;
    this.rendition.themes.default({
      body: {
        "font-family": `${family} !important`,
        "font-size": `${t.fontSizePx}px !important`,
        "line-height": `${t.lineHeight} !important`,
        color: `${palette.textPrimary} !important`,
        background: `${palette.page} !important`,
        "text-align": "left",
        hyphens: "auto",
      },
      p: {
        "line-height": `${t.lineHeight} !important`,
      },
      // warm, underlined links — never bright blue at night, and
      // distinguishable by more than color (PRODUCT.md)
      a: {
        color: `${palette.accent} !important`,
        "text-decoration": "underline",
        "text-underline-offset": "2px",
      },
      "::selection": {
        background: palette.selection,
      },
    });
    this.rendition.themes.fontSize(`${t.fontSizePx}px`);
  }

  destroy(): void {
    try {
      this.rendition?.destroy();
      this.book?.destroy();
    } catch {
      // destruction must never throw into the shell
    }
    this.rendition = null;
    this.book = null;
  }
}
