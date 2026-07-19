import ePub, { Book, Contents, Rendition } from "epubjs";
import type Section from "epubjs/types/section";
import type { ThemeName } from "../../../config/tokens";
import { themes } from "../../../config/tokens";
import { stackFor, type TypographySettings } from "../../../config/typography";
import { sentenceAroundSelection } from "../../../lib/selectionContext";
import { fetchBookBytes } from "../../../services/bookData";
import { takeGraphemes, type LocatorEnvelope, type TextQuote } from "../locator";
import { epubReadingProgress } from "../progress";
import type {
  EngineAnnotation,
  EngineKeyInput,
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
    displayed?: {
      page: number;
      total: number;
    };
  };
  atEnd?: boolean;
}

/** W3C-style text-quote anchor with ~64 chars of context on each side. */
function buildTextQuote(range: Range, exact: string): TextQuote {
  const root = range.startContainer.ownerDocument?.body;
  if (!root) return { exact, prefix: "", suffix: "" };
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const after = range.cloneRange();
  after.selectNodeContents(root);
  after.setStart(range.endContainer, range.endOffset);
  return {
    exact,
    prefix: takeGraphemes(before.toString(), 64, true),
    suffix: takeGraphemes(after.toString(), 64),
  };
}

function buildCollapsedTextQuote(range: Range): TextQuote | null {
  const root = range.startContainer.ownerDocument?.body;
  if (!root) return null;
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const full = root.textContent ?? "";
  const remainder = full.substring(before.toString().length);
  const leading = remainder.search(/\S/u);
  if (leading === -1) return null;
  const start = before.toString().length + leading;
  const exact = takeGraphemes(full.substring(start), 32);
  if (!exact.trim()) return null;
  return {
    exact,
    prefix: takeGraphemes(full.substring(0, start), 64, true),
    suffix: takeGraphemes(full.substring(start + exact.length), 64),
  };
}

/** Resolve a quote inside a loaded spine section and return a fresh CFI. */
function cfiForTextQuote(section: Section, quote: TextQuote): string | null {
  const root = section.contents;
  if (!root || !quote.exact) return null;
  const walker = section.document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let full = "";
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push(node);
    full += node.data;
  }
  const candidates: { at: number; score: number }[] = [];
  let from = 0;
  while (from <= full.length) {
    const at = full.indexOf(quote.exact, from);
    if (at === -1) break;
    const before = full.substring(Math.max(0, at - quote.prefix.length), at);
    const after = full.substring(
      at + quote.exact.length,
      at + quote.exact.length + quote.suffix.length,
    );
    candidates.push({
      at,
      score: Number(before.endsWith(quote.prefix)) + Number(after.startsWith(quote.suffix)),
    });
    from = at + Math.max(1, quote.exact.length);
  }
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best) return null;
  const locate = (offset: number): { node: Text; offset: number } | null => {
    let consumed = 0;
    for (const node of nodes) {
      if (offset <= consumed + node.data.length) {
        return { node, offset: offset - consumed };
      }
      consumed += node.data.length;
    }
    return null;
  };
  const start = locate(best.at);
  const end = locate(best.at + quote.exact.length);
  if (!start || !end) return null;
  const range = section.document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return section.cfiFromRange(range);
}

/**
 * Resolve once the element has a non-zero layout size (or a timeout), so
 * epub.js never renders into a 0-height box and fall back to scrolled flow.
 */
function waitForSize(
  el: HTMLElement,
  timeoutMs = 2000,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const read = () => ({ width: el.clientWidth, height: el.clientHeight });
    const initial = read();
    if (initial.width > 0 && initial.height > 0) {
      resolve(initial);
      return;
    }
    const start = performance.now();
    const tick = () => {
      const s = read();
      if ((s.width > 0 && s.height > 0) || performance.now() - start > timeoutMs) {
        resolve(s.width > 0 && s.height > 0 ? s : { width: 800, height: 600 });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
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
  private publisherStyles = false;
  private selectionHandler: ((sel: EngineSelection | null) => void) | null = null;
  private footnoteHandler: ((note: { text: string; rect: DOMRect }) => void) | null = null;
  private wheelHandler: ((deltaY: number) => void) | null = null;
  private keyHandler: ((event: EngineKeyInput) => boolean) | null = null;
  private activityHandler: (() => void) | null = null;
  private externalLinkHandler: ((url: string) => void) | null = null;
  private appliedHighlights = new Map<string, string>(); // id -> cfi
  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: number | null = null;
  private relocationGeneration = 0;
  private spineCount = 1;

  async open(args: EngineOpenArgs): Promise<void> {
    const bytes = await fetchBookBytes(args.fileUrl);
    this.language = args.book.language;
    this.publisherStyles = args.publisherStyles;
    this.book = ePub(bytes);
    const book = this.book;
    this.spineCount = Math.max(1, (await book.loaded.spine).length);

    // Sanitize each chapter's parsed DOM before epub.js serializes it into
    // an iframe, so hostile remote resources never begin loading (ADR 0005).
    const spineHooks = book.spine as unknown as {
      hooks?: { content?: { register: (fn: (doc: Document) => void) => void } };
    };
    spineHooks.hooks?.content?.register((doc: Document) => {
      sanitizeDom(doc);
    });

    // epub.js can only paginate if the container has a real height when it
    // renders. If we render before layout settles (more likely on large/
    // high-DPI windows), it falls back to a vertical scroll — the reported
    // "scrolls down instead of flipping". Wait for a non-zero size, then hand
    // epub.js explicit pixel dimensions so paginated flow is unambiguous.
    const size = await waitForSize(args.container);
    this.rendition = book.renderTo(args.container, {
      width: size.width,
      height: size.height,
      flow: "paginated",
      spread: "none",
      allowScriptedContent: false,
    });

    this.container = args.container;

    // Bundled fonts AND our theme are injected through the content hook — the
    // one mechanism that reliably fires for every chapter render (epub.js's
    // themes API / getContents timing is unreliable in the packaged build,
    // which left the page transparent → white). A transparent chapter renders
    // white, so this is what guarantees Ember is actually dark.
    this.rendition.hooks.content.register((contents: Contents) => {
      void contents.addStylesheet(`${window.location.origin}/reader-fonts.css`);
      this.injectThemeInto(contents.document);
    });

    // selection → toolbar. epub.js emits "selected" with the CFI range;
    // clearing is watched via selectionchange inside each chapter document.
    this.rendition.on("selected", (cfiRange: string, contents: Contents) => {
      const sel = contents.window.getSelection();
      const text = sel?.toString() ?? "";
      if (!text.trim() || !this.selectionHandler) return;
      const range = sel!.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const before = range.cloneRange();
      before.selectNodeContents(contents.document.body);
      before.setEnd(range.startContainer, range.startOffset);
      const after = range.cloneRange();
      after.selectNodeContents(contents.document.body);
      after.setStart(range.endContainer, range.endOffset);
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
        context: sentenceAroundSelection(before.toString(), text, after.toString()),
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
          const externalHref = anchor.getAttribute("data-external-href");
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
          } else if (externalHref || /^https?:/i.test(href)) {
            // never navigate the reading surface to a remote origin
            e.preventDefault();
            e.stopPropagation();
            const url = externalHref ?? href;
            if (/^https?:\/\//i.test(url)) this.externalLinkHandler?.(url);
          }
        },
        true,
      );

      // Wheel-to-flip: the chapter iframe swallows wheel events, so forward
      // them to the shell. Paginated content does not scroll, so we can
      // safely turn the page on a wheel gesture.
      contents.document.addEventListener(
        "wheel",
        (e: WheelEvent) => {
          if (this.wheelHandler) {
            e.preventDefault();
            this.wheelHandler(e.deltaY);
          }
        },
        { passive: false },
      );

      // EPUB lives in an iframe, so keyboard and pointer events do not bubble
      // into the reader shell. Forward them explicitly to keep fullscreen,
      // page turns, and the fading controls available while reading.
      contents.document.addEventListener("keydown", (event: KeyboardEvent) => {
        const consumed = this.keyHandler?.({
          key: event.key,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
        });
        if (consumed) event.preventDefault();
      });
      contents.document.addEventListener("mousemove", () => this.activityHandler?.());
    });

    this.applyTypography(args.typography);
    this.applyTheme(args.theme);

    // Every time epub.js renders a chapter (open, navigation, resize) it can
    // reset styles to the publication default, so re-apply our theme after
    // each render — this keeps Ember dark no matter what triggers a re-render.
    this.rendition.on("rendered", () => this.injectContentStyles());

    // epub.js paginates on open but does not re-flow on container resize, so
    // a maximize/resize can leave columns mis-sized (content appears to scroll
    // instead of paginate). Re-flow on size change, preserving the location.
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        const loc = this.rendition?.currentLocation() as unknown as
          { start?: { cfi: string } } | undefined;
        const cfi = loc?.start?.cfi;
        try {
          const w = this.container?.clientWidth ?? 0;
          const h = this.container?.clientHeight ?? 0;
          if (w > 0 && h > 0) {
            this.rendition?.resize(w, h);
            // resize can drift the position; re-anchor to where we were
            if (cfi) void this.rendition?.display(cfi);
            this.injectContentStyles();
          }
        } catch {
          // never let a resize hiccup break reading
        }
      }, 180);
    });
    this.resizeObserver.observe(args.container);

    this.rendition.on("relocated", (location: RelocatedLocation) => {
      this.announceRelocation(location, args);
    });

    // epub.js only reports text-length-based percentages after its location
    // map exists. Generate it without delaying the first page; the temporary
    // display estimate is replaced as soon as the map is ready.
    void book.locations
      .generate(1600)
      .then(() => {
        if (this.book !== book || !this.rendition) return;
        const current = this.rendition.currentLocation() as unknown as RelocatedLocation;
        if (!current?.start?.cfi) return;
        const percentage = book.locations.percentageFromCfi(current.start.cfi);
        this.announceRelocation({ ...current, start: { ...current.start, percentage } }, args);
      })
      .catch(() => {
        // The chapter/page estimate remains available for malformed books.
      });
  }

  private announceRelocation(location: RelocatedLocation, args: EngineOpenArgs): void {
    const generation = ++this.relocationGeneration;
    void (async () => {
      const sectionTitle = await this.sectionTitle(location.start.href);
      let textQuote: TextQuote | null = null;
      try {
        const range = await this.book?.getRange(location.start.cfi);
        if (range) textQuote = buildCollapsedTextQuote(range);
      } catch {
        // primary + coarse anchors still remain valid
      }
      const progress = epubReadingProgress(location.start, this.spineCount, location.atEnd);
      const envelope: LocatorEnvelope = {
        v: 1,
        engine: "epub",
        primary: {
          cfi: location.start.cfi,
          spineIndex: location.start.index,
          href: location.start.href,
        },
        textQuote,
        coarse: {
          sectionTitle,
          spineIndex: location.start.index,
          ...(progress === null ? {} : { progress }),
        },
      };
      if (generation !== this.relocationGeneration) return;
      args.onLocatorChanged(envelope, { sectionTitle, pageIndex: null });
    })();
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
        if (locator.textQuote?.exact && this.book) {
          const range = await this.book.getRange(locator.primary.cfi);
          if (!range.toString().includes(locator.textQuote.exact)) throw new Error("stale CFI");
        }
        await this.rendition.display(locator.primary.cfi);
        return;
      } catch {
        const quoteTarget = await this.findTextQuote(locator);
        if (quoteTarget) {
          await this.rendition.display(quoteTarget);
          return;
        }
        // fall through to coarse anchor — never jump to a rounded percentage
        if (typeof locator.coarse.spineIndex === "number") {
          await this.rendition.display(locator.coarse.spineIndex);
          return;
        }
      }
    }
    await this.rendition.display();
  }

  private async findTextQuote(locator: LocatorEnvelope): Promise<string | null> {
    if (locator.engine !== "epub" || !locator.textQuote?.exact || !this.book) return null;
    const count = (await this.book.loaded.spine).length;
    const preferred = locator.coarse.spineIndex ?? locator.primary.spineIndex;
    const indices = [preferred, preferred - 1, preferred + 1];
    for (let index = 0; index < count; index += 1) indices.push(index);
    for (const index of Array.from(new Set(indices))) {
      if (index < 0 || index >= count) continue;
      const section = this.book.spine.get(index);
      try {
        await Promise.resolve(section.load(this.book.load.bind(this.book)));
        const target = cfiForTextQuote(section, locator.textQuote);
        if (target) return target;
      } catch {
        // continue through malformed sections
      } finally {
        section.unload();
      }
    }
    return null;
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

  applyPublisherStyles(enabled: boolean): void {
    this.publisherStyles = enabled;
    this.injectContentStyles();
  }

  /** The reading-theme CSS injected into every chapter document. */
  /** Cosmetic rules delivered as an EXTERNAL stylesheet (CSP-permitted). */
  private themeLinkCss(palette: (typeof themes)[keyof typeof themes], lineHeight: number): string {
    if (this.publisherStyles && this.theme === "paper") {
      return `
        a { color: ${palette.accent} !important; text-decoration: underline; text-underline-offset: 2px; }
        ::selection { background: ${palette.selection}; }
      `;
    }
    // A publisher/Calibre wrapper often ships its own light background; force
    // every element transparent so only html/body (painted below via CSSOM)
    // show the page color. Keep link/selection colors on-theme.
    return `
      * { background-color: transparent !important; }
      a { color: ${palette.accent} !important; text-decoration: underline; text-underline-offset: 2px; }
      p { line-height: ${lineHeight} !important; }
      aside, blockquote, [role="note"], [role="doc-tip"], [role="doc-example"],
      [epub\\:type~="sidebar"], [epub\\:type~="note"], [epub\\:type~="tip"],
      [class*="callout" i], [class*="sidebar" i], [class~="box" i],
      [class*="anecdote" i], [class*="blockquote" i] {
        background-color: ${palette.raised} !important;
        border-inline-start: 0.2rem solid ${palette.accent} !important;
        border-radius: 0.35rem;
        margin-block: 1.25em;
        padding: 0.85em 1em;
      }
      ::selection { background: ${palette.selection}; }
      img, svg, video { forced-color-adjust: none; }
    `;
  }

  /**
   * Theme a chapter document. The packaged WebView2 inherits the app CSP into
   * this same-origin iframe, and that CSP has no `style-src 'unsafe-inline'`, so
   * an injected inline `<style>` (or epub.js themes.default) is parsed but never
   * applied — the transparent document then renders WHITE. Two CSP-safe channels
   * fix this: (1) CSSOM writes (`el.style.x = y`) are exempt from CSP and carry
   * the load-bearing background/text/font; (2) an EXTERNAL blob stylesheet is
   * permitted (same mechanism that loads the bundled fonts) and carries the
   * cosmetic rules. Idempotent.
   */
  private injectThemeInto(doc: Document): void {
    try {
      if (!doc?.documentElement) return;
      const palette = themes[this.theme];
      const t = this.typography;
      const family =
        this.language && stackFor(this.language) !== stackFor(null)
          ? stackFor(this.language)
          : (t?.fontFamily ?? "Georgia, serif");
      const fontSize = t?.fontSizePx ?? 20;
      const lineHeight = t?.lineHeight ?? 1.58;
      const dark = this.theme !== "paper";

      // (1) CSSOM — immune to CSP, applies synchronously (no white flash).
      const html = doc.documentElement;
      html.style.setProperty("background", palette.page, "important");
      html.style.colorScheme = dark ? "dark" : "light";
      const body = doc.body;
      if (body) {
        body.style.setProperty("background", palette.page, "important");
        body.style.setProperty("color", palette.textPrimary, "important");
        body.style.setProperty("font-family", family, "important");
        body.style.setProperty("font-size", `${fontSize}px`, "important");
        body.style.setProperty("line-height", String(lineHeight), "important");
      }

      // (2) External blob stylesheet for the cosmetic rules.
      if (doc.head) {
        const css = this.themeLinkCss(palette, lineHeight);
        const url = URL.createObjectURL(new Blob([css], { type: "text/css" }));
        let link = doc.getElementById("lectorium-theme") as HTMLLinkElement | null;
        if (!link) {
          link = doc.createElement("link");
          link.id = "lectorium-theme";
          link.rel = "stylesheet";
          doc.head.appendChild(link);
        } else if (link.href.startsWith("blob:")) {
          URL.revokeObjectURL(link.href);
        }
        link.href = url;
      }
    } catch {
      // never let a styling poke break reading
    }
  }

  /** Apply the current theme/typography to every live chapter document. */
  private injectContentStyles(): void {
    if (!this.rendition) return;
    const palette = themes[this.theme];
    try {
      const iframe = this.container?.querySelector("iframe");
      if (iframe) iframe.style.background = palette.page;
      const contents = this.rendition.getContents() as unknown as Array<{ document: Document }>;
      const list = Array.isArray(contents) ? contents : contents ? [contents] : [];
      for (const c of list) this.injectThemeInto(c.document);
    } catch {
      // never let a styling poke break reading
    }
  }

  destroy(): void {
    if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
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

  onWheel(handler: (deltaY: number) => void): void {
    this.wheelHandler = handler;
  }

  onKeyDown(handler: (event: EngineKeyInput) => boolean): void {
    this.keyHandler = handler;
  }

  onActivity(handler: () => void): void {
    this.activityHandler = handler;
  }

  onExternalLink(handler: (url: string) => void): void {
    this.externalLinkHandler = handler;
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
