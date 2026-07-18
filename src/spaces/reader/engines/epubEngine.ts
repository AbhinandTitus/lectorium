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
    if (!this.rendition) return;
    const family = this.language ? stackFor(this.language) : t.fontFamily;
    this.rendition.themes.default({
      body: {
        "font-family": `${family} !important`,
        "font-size": `${t.fontSizePx}px !important`,
        "line-height": `${t.lineHeight} !important`,
        // column width is handled by epub.js; keep measure via padding
        "text-align": "left",
        hyphens: "auto",
      },
      p: {
        "line-height": `${t.lineHeight} !important`,
      },
      "::selection": {
        background: "var(--selection, #5A452D)",
      },
    });
    this.rendition.themes.fontSize(`${t.fontSizePx}px`);
  }

  applyTheme(theme: ThemeName): void {
    if (!this.rendition) return;
    const palette = themes[theme];
    this.rendition.themes.override("color", palette.textPrimary);
    this.rendition.themes.override("background", palette.page);
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
