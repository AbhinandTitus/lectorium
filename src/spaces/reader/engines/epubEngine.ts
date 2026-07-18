import ePub, { Book, Contents, Rendition } from "epubjs";
import type Section from "epubjs/types/section";
import type { ThemeName } from "../../../config/tokens";
import { themes } from "../../../config/tokens";
import { stackFor, type TypographySettings } from "../../../config/typography";
import { fetchBookBytes } from "../../../services/bookData";
import type { LocatorEnvelope, TextQuote } from "../locator";
import type {
  EngineAnnotation,
  EngineOpenArgs,
  EngineSelection,
  ReaderEngine,
  SearchHit,
  TocEntry,
} from "./types";

interface RelocatedLocation {
  start: {
    cfi: string;
    href: string;
    index: number;
    percentage?: number;
  };
}

/** W3C-style text-quote anchor with ~64 chars of context on each side. */
function buildTextQuote(range: Range, exact: string): TextQuote {
  const context = (node: Node | null, offset: number, before: boolean): string => {
    if (!node || node.nodeType !== Node.TEXT_NODE) return "";
    const data = (node as Text).data;
    const slice = before
      ? data.slice(Math.max(0, offset - 64), offset)
      : data.slice(offset, offset + 64);
    // never cut inside a surrogate pair (Malayalam-safe truncation)
    return slice.replace(/^[\uDC00-\uDFFF]/, "").replace(/[\uD800-\uDBFF]$/, "");
  };
  return {
    exact,
    prefix: context(range.startContainer, range.startOffset, true),
    suffix: context(range.endContainer, range.endOffset, false),
  };
}

const REMOTE_URL = /^\s*(https?:)?\/\//i;

/**
 * Strip active/remote content from a parsed chapter document IN PLACE, so
 * hostile resources never start to load (ADR 0005). Runs in epub.js's
 * `content` hook, before the iframe is written. Scripts are additionally
 * dead via the sandbox; this removes them plus event handlers, javascript:
 * URLs, and every absolute remote reference. Internal (relative/blob/data)
 * resources are preserved. Returns the same root for convenience/testing.
 */
export function sanitizeDom<T extends Document | Element>(root: T): T {
  const q = (sel: string): Element[] => Array.from(root.querySelectorAll(sel));

  for (const el of q("script, iframe, object, embed, form, base, meta[http-equiv]")) {
    el.remove();
  }
  for (const el of q("link")) {
    if (REMOTE_URL.test(el.getAttribute("href") ?? "")) el.remove();
  }
  for (const el of q("style")) {
    const css = el.textContent ?? "";
    if (/@import/i.test(css) || /url\(\s*["']?\s*(https?:)?\/\//i.test(css)) {
      el.textContent = css
        .replace(/@import[^;]+;/gi, "/* remote import removed */")
        .replace(/url\(\s*["']?\s*(https?:)?\/\/[^)]*\)/gi, "url()");
    }
  }
  for (const el of q("*")) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith("on") || /^javascript:/i.test(value)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === "src" || name === "href" || name === "poster" || name === "srcset") &&
        REMOTE_URL.test(value)
      ) {
        // external links keep their text but lose the live target; the
        // shell offers explicit confirmation flows for real link-outs
        if (name === "href") el.setAttribute("data-external-href", value);
        el.removeAttribute(attr.name);
      }
    }
    const style = el.getAttribute("style");
    if (style && /url\(\s*["']?\s*(https?:)?\/\//i.test(style)) {
      el.removeAttribute("style");
    }
  }
  return root;
}

/** String-in/string-out wrapper (used by unit tests). */
export function sanitizeChapter(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitizeDom(doc);
  return "<!DOCTYPE html>" + doc.documentElement.outerHTML;
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
  private selectionHandler: ((sel: EngineSelection | null) => void) | null = null;
  private footnoteHandler: ((note: { text: string; rect: DOMRect }) => void) | null = null;
  private appliedHighlights = new Map<string, string>(); // id -> cfi
  private container: HTMLElement | null = null;

  async open(args: EngineOpenArgs): Promise<void> {
    const bytes = await fetchBookBytes(args.fileUrl);
    this.language = args.book.language;
    this.book = ePub(bytes);
    const book = this.book;

    // Sanitize each chapter's parsed DOM before epub.js serializes it into
    // an iframe, so hostile remote resources never begin loading (ADR 0005).
    const spineHooks = book.spine as unknown as {
      hooks?: { content?: { register: (fn: (doc: Document) => void) => void } };
    };
    spineHooks.hooks?.content?.register((doc: Document) => {
      sanitizeDom(doc);
    });

    this.rendition = book.renderTo(args.container, {
      width: "100%",
      height: "100%",
      flow: "paginated",
      spread: "none",
      allowScriptedContent: false,
    });

    this.container = args.container;

    // bundled fonts (incl. Malayalam) must exist inside each chapter iframe
    this.rendition.hooks.content.register((contents: Contents) =>
      contents.addStylesheet(`${window.location.origin}/reader-fonts.css`),
    );

    // selection → toolbar. epub.js emits "selected" with the CFI range;
    // clearing is watched via selectionchange inside each chapter document.
    this.rendition.on("selected", (cfiRange: string, contents: Contents) => {
      const sel = contents.window.getSelection();
      const text = sel?.toString() ?? "";
      if (!text.trim() || !this.selectionHandler) return;
      const range = sel!.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const iframe = this.container?.querySelector("iframe");
      const frameRect = iframe?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const location = this.rendition?.currentLocation() as unknown as
        { start?: { index: number; href: string } } | undefined;
      const envelope: LocatorEnvelope = {
        v: 1,
        engine: "epub",
        primary: {
          cfi: cfiRange,
          spineIndex: location?.start?.index ?? 0,
          href: location?.start?.href ?? "",
        },
        textQuote: buildTextQuote(range, text),
        coarse: { sectionTitle: null, spineIndex: location?.start?.index },
      };
      this.selectionHandler({
        text,
        locator: envelope,
        rect: {
          x: rect.x + frameRect.left,
          y: rect.y + frameRect.top,
          width: rect.width,
          height: rect.height,
        },
      });
    });
    this.rendition.hooks.content.register((contents: Contents) => {
      contents.document.addEventListener("selectionchange", () => {
        const s = contents.window.getSelection();
        if ((!s || s.isCollapsed) && this.selectionHandler) this.selectionHandler(null);
      });

      // Footnotes: noterefs open a small in-app popover and never navigate.
      // External links require explicit confirmation (handled by the shell).
      contents.document.addEventListener(
        "click",
        (e: MouseEvent) => {
          const anchor = (e.target as Element | null)?.closest?.("a");
          if (!anchor) return;
          const epubType =
            anchor.getAttribute("epub:type") ??
            anchor.getAttributeNS?.("http://www.idpf.org/2007/ops", "type");
          const href = anchor.getAttribute("href") ?? "";
          if (epubType === "noteref" || href.startsWith("#")) {
            const id = href.split("#")[1];
            const target = id ? contents.document.getElementById(id) : null;
            if (target && this.footnoteHandler) {
              e.preventDefault();
              e.stopPropagation();
              const text = target.textContent?.trim() ?? "";
              const iframe = this.container?.querySelector("iframe");
              const frameRect = iframe?.getBoundingClientRect() ?? { left: 0, top: 0 };
              const r = anchor.getBoundingClientRect();
              this.footnoteHandler({
                text,
                rect: new DOMRect(r.x + frameRect.left, r.y + frameRect.top, r.width, r.height),
              });
            }
          } else if (/^https?:/i.test(href)) {
            // never navigate the reading surface to a remote origin
            e.preventDefault();
            e.stopPropagation();
          }
        },
        true,
      );
    });

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
    // Malayalam always uses its script-aware stack; Latin content honors the
    // calibrated/preset font from typography settings.
    const family =
      this.language && stackFor(this.language) !== stackFor(null)
        ? stackFor(this.language)
        : t.fontFamily;
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

  async toc(): Promise<TocEntry[]> {
    const nav = await this.book?.loaded.navigation;
    const out: TocEntry[] = [];
    const walk = (
      items: { label: string; href: string; subitems?: unknown[] }[],
      depth: number,
    ) => {
      for (const item of items) {
        out.push({ label: item.label.trim(), target: item.href, depth });
        if (Array.isArray(item.subitems) && item.subitems.length > 0) {
          walk(item.subitems as { label: string; href: string; subitems?: unknown[] }[], depth + 1);
        }
      }
    };
    if (nav?.toc) walk(nav.toc, 0);
    return out;
  }

  async goTo(target: string): Promise<void> {
    await this.rendition?.display(target);
  }

  /** Search every spine section (loaded transiently, then unloaded). */
  async search(query: string): Promise<SearchHit[]> {
    const book = this.book;
    if (!book || query.trim().length < 2) return [];
    const hits: SearchHit[] = [];
    const spine = book.spine as unknown as { each: (cb: (s: Section) => void) => void };
    const sections: Section[] = [];
    spine.each((s) => sections.push(s));
    for (const section of sections) {
      try {
        // typed as non-thenable but returns a promise at runtime
        await Promise.resolve(section.load(book.load.bind(book)));
        const found = section.find(query) as unknown as { cfi: string; excerpt: string }[];
        const title = await this.sectionTitle(section.href);
        for (const f of found) {
          hits.push({ target: f.cfi, excerpt: f.excerpt, sectionTitle: title });
        }
      } catch {
        // a malformed section must not break search
      } finally {
        section.unload();
      }
      if (hits.length >= 200) break; // keep the panel calm and bounded
    }
    return hits;
  }

  onSelection(handler: (sel: EngineSelection | null) => void): void {
    this.selectionHandler = handler;
  }

  onFootnote(handler: (note: { text: string; rect: DOMRect }) => void): void {
    this.footnoteHandler = handler;
  }

  setHighlights(annotations: EngineAnnotation[]): void {
    if (!this.rendition) return;
    const next = new Map(annotations.map((a) => [a.id, a]));
    // remove stale
    for (const [id, cfi] of this.appliedHighlights) {
      if (!next.has(id)) {
        try {
          this.rendition.annotations.remove(cfi, "highlight");
        } catch {
          /* already gone */
        }
        this.appliedHighlights.delete(id);
      }
    }
    // add new
    for (const a of annotations) {
      if (this.appliedHighlights.has(a.id) || a.locator.engine !== "epub") continue;
      const cfi = a.locator.primary.cfi;
      try {
        this.rendition.annotations.highlight(cfi, { id: a.id }, undefined, "lectorium-hl", {
          fill: themes[this.theme].selection,
          "fill-opacity": "0.45",
          "mix-blend-mode": "multiply",
        });
        this.appliedHighlights.set(a.id, cfi);
      } catch {
        /* unresolvable CFI — re-anchoring is handled at the shell level */
      }
    }
  }
}
