import ePub, { Book, Contents, EpubCFI, Rendition } from "epubjs";
import type Section from "epubjs/types/section";
import type { ThemeName } from "../../../config/tokens";
import { themes } from "../../../config/tokens";
import { stackFor, type TypographySettings } from "../../../config/typography";
import { sentenceAroundSelection } from "../../../lib/selectionContext";
import { fetchBookBytes } from "../../../services/bookData";
import { takeGraphemes, type LocatorEnvelope, type TextQuote } from "../locator";
import { epubReadingProgress } from "../progress";
import {
  chapterRuns,
  collapsedQuoteAt,
  findQuoteOffset,
  locateOffset,
  pageBoxOf,
  pageStartFor,
  textStartsWith,
  type ChapterRun,
} from "./epubLayout";
import type {
  BookTextSection,
  ChapterPosition,
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

interface NavNode {
  label: string;
  href: string;
  subitems?: NavNode[];
}

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const THEME_LINK_ID = "lectorium-theme";
const FONTS_LINK_ID = "lectorium-fonts";
/** publisher `style=""` is parked here and re-applied through the CSSOM */
const PARKED_STYLE_ATTR = "data-lectorium-style";
/** breathing room kept between a full-page image and the column edge */
const IMAGE_MARGIN_PX = 56;
const RESIZE_DEBOUNCE_MS = 140;
const SETTLE_ATTEMPTS = 5;
const FONT_WAIT_MS = 1200;

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

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Resolve once the page host has a real size (or a timeout passes). */
async function waitForPageBox(
  el: HTMLElement,
  timeoutMs = 2000,
): Promise<{ width: number; height: number }> {
  const start = performance.now();
  for (;;) {
    const box = pageBoxOf(el);
    if (box) return box;
    if (performance.now() - start > timeoutMs) return { width: 800, height: 600 };
    await nextFrame();
  }
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
 *
 * Two rules keep the reading position exact (ADR 0004):
 *
 * 1. Everything that affects layout — typography, the page-fitting rules
 *    for images, publisher CSS — is in the chapter document BEFORE epub.js
 *    measures it. epub.js decides which page to show once, right after
 *    load; anything applied later moves the text under a fixed scroll
 *    offset and the reader lands pages away from where they were.
 * 2. Every programmatic move (open, resize, typography, jump) is followed
 *    by a settle step that waits for fonts, re-measures, and re-anchors on
 *    the intended passage. Until it settles, no location is announced, so
 *    an intermediate position can never be autosaved over the real one.
 */
export class EpubEngine implements ReaderEngine {
  private book: Book | null = null;
  private rendition: Rendition | null = null;
  private args: EngineOpenArgs | null = null;
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
  private size: { width: number; height: number } = { width: 0, height: 0 };
  private spineCount = 1;

  /** the passage the reader is on; survives resize and restyle */
  private anchor: string | null = null;
  private navToken = 0;
  private settling = false;

  private themeUrl: string | null = null;
  /** blob URLs minted for publisher inline styles; revoked on destroy */
  private ownedUrls = new Set<string>();

  private runs: ChapterRun[] = [];
  /** characters of text per spine item; filled in the background */
  private sectionChars: number[] | null = null;

  async open(args: EngineOpenArgs): Promise<void> {
    const bytes = await fetchBookBytes(args.fileUrl);
    this.args = args;
    this.language = args.book.language;
    this.publisherStyles = args.publisherStyles;
    this.typography = args.typography;
    this.theme = args.theme;
    this.container = args.container;
    this.book = ePub(bytes);
    const book = this.book;
    // `opened` resolves after epub.js has registered its own resource
    // substitution, so our hooks see chapter documents in their final form.
    await book.opened;
    this.spineCount = Math.max(1, (await book.loaded.spine).length);
    await this.buildChapterRuns();

    this.themeUrl = this.makeThemeUrl();

    // Sanitize, then prepare each chapter's parsed DOM before epub.js
    // serializes it into an iframe: hostile resources never begin loading
    // (ADR 0005) and our styles are present before the first measurement.
    const spineHooks = book.spine as unknown as {
      hooks?: {
        content?: { register: (fn: (doc: Document, section: Section) => void) => void };
      };
    };
    spineHooks.hooks?.content?.register((doc: Document, section: Section) => {
      sanitizeDom(doc);
      this.prepareDocument(doc, section);
    });

    // epub.js can only paginate into a box with a real size. Wait for one,
    // then hand it explicit pixel dimensions so paginated flow is unambiguous.
    this.size = await waitForPageBox(args.container);
    this.createRendition();

    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => void this.handleResize(), RESIZE_DEBOUNCE_MS);
    });
    this.resizeObserver.observe(args.container);

    void this.measureSections();
  }

  private createRendition(): void {
    const book = this.book;
    const container = this.container;
    if (!book || !container) return;

    this.rendition = book.renderTo(container, {
      width: this.size.width,
      height: this.size.height,
      flow: "paginated",
      spread: "none",
      allowScriptedContent: false,
    });
    const rendition = this.rendition;

    // The load-bearing styles are already in the document (prepareDocument).
    // This hook repeats them through the CSSOM, which no CSP can block, and
    // restores publisher inline styles the same way.
    rendition.hooks.content.register((contents: Contents) => {
      this.applyLiveStyles(contents.document);
      this.attachContentListeners(contents);
    });

    // selection → toolbar. epub.js emits "selected" with the CFI range;
    // clearing is watched via selectionchange inside each chapter document.
    rendition.on("selected", (cfiRange: string, contents: Contents) => {
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
      const frameRect = this.frameRect();
      const location = this.currentLocation();
      const envelope: LocatorEnvelope = {
        v: 1,
        engine: "epub",
        primary: {
          cfi: cfiRange,
          spineIndex: location?.start.index ?? 0,
          href: location?.start.href ?? "",
        },
        textQuote: buildTextQuote(range, text),
        coarse: {
          sectionTitle: location ? this.titleForSpine(location.start.index) : null,
          spineIndex: location?.start.index,
        },
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

    rendition.on("relocated", (location: RelocatedLocation) => {
      // A programmatic move is still settling; its intermediate positions
      // are not where the reader is.
      if (this.settling) return;
      this.anchor = location.start.cfi;
      this.announce(location);
    });
  }

  private attachContentListeners(contents: Contents): void {
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
            const frameRect = this.frameRect();
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
  }

  // ---- chapters, titles, progress ----

  private async buildChapterRuns(): Promise<void> {
    const book = this.book;
    if (!book) return;
    const titles: (string | null)[] = new Array<string | null>(this.spineCount).fill(null);
    try {
      const nav = await book.loaded.navigation;
      const walk = (items: NavNode[]) => {
        for (const item of items) {
          const index = this.spineIndexForHref(item.href);
          const label = item.label?.trim();
          if (index !== null && label && titles[index] === null) titles[index] = label;
          if (Array.isArray(item.subitems) && item.subitems.length > 0) walk(item.subitems);
        }
      };
      if (nav?.toc) walk(nav.toc);
    } catch {
      // a book without navigation still reads; it simply has one chapter
    }
    this.runs = chapterRuns(titles);
  }

  private spineIndexForHref(href: string): number | null {
    const book = this.book;
    if (!book || !href) return null;
    const clean = href.split("#")[0];
    try {
      const direct = book.spine.get(clean) as Section | null;
      if (direct) return direct.index;
    } catch {
      // fall through to the basename match
    }
    // Navigation documents in another folder address chapters with a
    // different relative path; a unique file-name match is still exact.
    const base = decodeURIComponent(clean.split("/").pop() ?? "");
    if (!base) return null;
    let found: number | null = null;
    let ambiguous = false;
    this.eachSection((section) => {
      const name = decodeURIComponent((section.href ?? "").split("/").pop() ?? "");
      if (name === base) {
        if (found !== null) ambiguous = true;
        found = section.index;
      }
    });
    return ambiguous ? null : found;
  }

  private eachSection(fn: (section: Section) => void): void {
    const spine = this.book?.spine as unknown as
      { each: (cb: (s: Section) => void) => void } | undefined;
    spine?.each(fn);
  }

  private runForSpine(index: number): ChapterRun | null {
    return this.runs.find((run) => index >= run.start && index < run.end) ?? null;
  }

  private titleForSpine(index: number): string | null {
    return this.runForSpine(index)?.title ?? null;
  }

  /** Count each spine item's text once, quietly, without touching epub.js's
   *  shared section cache (its own location map unloads sections mid-render). */
  private async measureSections(): Promise<void> {
    const book = this.book;
    if (!book) return;
    const sections: Section[] = [];
    this.eachSection((s) => sections.push(s));
    const chars: number[] = new Array<number>(sections.length).fill(0);
    for (const section of sections) {
      if (this.book !== book) return;
      try {
        const doc = (await book.load(section.url)) as unknown as Document;
        const text = doc?.body?.textContent ?? doc?.documentElement?.textContent ?? "";
        chars[section.index] = text.replace(/\s+/gu, " ").trim().length;
      } catch {
        // a malformed section counts as empty; reading is unaffected
      }
      await delay(0);
    }
    if (this.book !== book) return;
    this.sectionChars = chars;
    const location = this.currentLocation();
    if (location && !this.settling) this.announce(location);
  }

  private chapterPosition(location: RelocatedLocation, within: number): ChapterPosition | null {
    const run = this.runForSpine(location.start.index);
    if (!run) return null;
    const chars = this.sectionChars;
    const ordinal = this.runs.indexOf(run);
    if (!chars) {
      return {
        index: ordinal,
        total: this.runs.length,
        title: run.title,
        fraction: within,
        chars: null,
        charsLeft: null,
        bookCharsLeft: null,
      };
    }
    let total = 0;
    let before = 0;
    for (let i = run.start; i < run.end; i++) {
      const n = chars[i] ?? 0;
      if (i < location.start.index) before += n;
      else if (i === location.start.index) before += n * within;
      total += n;
    }
    let after = 0;
    for (let i = run.end; i < chars.length; i++) after += chars[i] ?? 0;
    const left = Math.max(0, total - before);
    return {
      index: ordinal,
      total: this.runs.length,
      title: run.title,
      fraction: total > 0 ? Math.min(1, before / total) : within,
      chars: Math.round(total),
      charsLeft: Math.round(left),
      bookCharsLeft: Math.round(left + after),
    };
  }

  private bookProgress(location: RelocatedLocation, within: number): number | null {
    const chars = this.sectionChars;
    if (chars) {
      const total = chars.reduce((sum, n) => sum + n, 0);
      if (total > 0) {
        let before = 0;
        for (let i = 0; i < location.start.index; i++) before += chars[i] ?? 0;
        before += (chars[location.start.index] ?? 0) * within;
        return Math.min(1, Math.max(0, before / total));
      }
    }
    return epubReadingProgress(location.start, this.spineCount, location.atEnd);
  }

  private announce(location: RelocatedLocation): void {
    const args = this.args;
    if (!args) return;
    const { start } = location;
    const sectionTitle = this.titleForSpine(start.index);
    let textQuote: TextQuote | null = null;
    try {
      const range = this.contentsFor(start.index)?.range(start.cfi);
      if (range) textQuote = collapsedQuoteAt(range);
    } catch {
      // primary + coarse anchors still remain valid
    }
    const displayed = start.displayed;
    const within =
      displayed && displayed.total > 0
        ? Math.min(1, Math.max(0, (displayed.page - 1) / displayed.total))
        : 0;
    const progress = this.bookProgress(location, within);
    const envelope: LocatorEnvelope = {
      v: 1,
      engine: "epub",
      primary: { cfi: start.cfi, spineIndex: start.index, href: start.href },
      textQuote,
      coarse: {
        sectionTitle,
        spineIndex: start.index,
        ...(progress === null ? {} : { progress }),
      },
    };
    args.onLocatorChanged(envelope, {
      sectionTitle,
      pageIndex: null,
      chapter: this.chapterPosition(location, within),
    });
  }

  // ---- position: resolve, show, settle ----

  private currentLocation(): RelocatedLocation | null {
    try {
      const location = this.rendition?.currentLocation() as unknown as RelocatedLocation | null;
      return location?.start?.cfi ? location : null;
    } catch {
      return null;
    }
  }

  private liveContents(): Contents[] {
    try {
      const contents = this.rendition?.getContents() as unknown as Contents[] | Contents | null;
      if (!contents) return [];
      return Array.isArray(contents) ? contents : [contents];
    } catch {
      return [];
    }
  }

  private contentsFor(spineIndex: number): Contents | null {
    return this.liveContents().find((c) => c.sectionIndex === spineIndex) ?? null;
  }

  private stage(): HTMLElement | null {
    return this.container?.querySelector<HTMLElement>(".epub-container") ?? null;
  }

  private frameRect(): { left: number; top: number } {
    return this.container?.querySelector("iframe")?.getBoundingClientRect() ?? { left: 0, top: 0 };
  }

  /** Hide the page while a programmatic move settles, so the reader never
   *  watches text jump. The surround is the page color, so nothing flashes. */
  private veil(on: boolean): void {
    const stage = this.stage();
    if (!stage) return;
    stage.style.transition = on ? "none" : "opacity 140ms ease";
    stage.style.opacity = on ? "0" : "1";
  }

  async display(locator: LocatorEnvelope | null): Promise<void> {
    if (!this.rendition) return;
    const target = locator?.engine === "epub" ? await this.resolveLocator(locator) : null;
    await this.show(target ?? undefined);
  }

  /**
   * Turn a stored envelope into something epub.js can display: the CFI when
   * it still points at the quoted words, the quote found again when it does
   * not, and the chapter as a last resort (ADR 0004).
   */
  private async resolveLocator(
    locator: Extract<LocatorEnvelope, { engine: "epub" }>,
  ): Promise<string | number | null> {
    const book = this.book;
    if (!book) return null;
    const quote = locator.textQuote?.exact ? locator.textQuote : null;
    try {
      const cfi = new EpubCFI(locator.primary.cfi);
      const section = book.spine.get(cfi.spinePos) as Section | null;
      if (section) {
        await Promise.resolve(section.load(book.load.bind(book)));
        const range = cfi.toRange(section.document);
        if (range && (!quote || textStartsWith(range, quote.exact))) return locator.primary.cfi;
      }
    } catch {
      // an unreadable CFI is expected after a file is replaced; use the quote
    }
    if (quote) {
      const found = await this.findTextQuote(locator, quote);
      if (found) return found;
    }
    const coarse = locator.coarse.spineIndex ?? locator.primary.spineIndex;
    return coarse >= 0 && coarse < this.spineCount ? coarse : null;
  }

  private async findTextQuote(
    locator: Extract<LocatorEnvelope, { engine: "epub" }>,
    quote: TextQuote,
  ): Promise<string | null> {
    const book = this.book;
    if (!book) return null;
    const preferred = locator.coarse.spineIndex ?? locator.primary.spineIndex;
    const order = [preferred, preferred - 1, preferred + 1];
    for (let index = 0; index < this.spineCount; index += 1) order.push(index);
    for (const index of Array.from(new Set(order))) {
      if (index < 0 || index >= this.spineCount) continue;
      const section = book.spine.get(index) as Section | null;
      if (!section) continue;
      const wasLoaded = Boolean(section.document);
      try {
        await Promise.resolve(section.load(book.load.bind(book)));
        const body = section.document?.body;
        if (!body) continue;
        const offset = findQuoteOffset(body.textContent ?? "", quote);
        if (offset === null) continue;
        const at = locateOffset(body, offset);
        if (!at) continue;
        const range = section.document.createRange();
        range.setStart(at.node, at.offset);
        range.collapse(true);
        return section.cfiFromRange(range);
      } catch {
        // continue through malformed sections
      } finally {
        if (!wasLoaded && !this.contentsFor(index)) this.unloadQuietly(section);
      }
    }
    return null;
  }

  /** Free a section we loaded only to read it. Never one that is on screen. */
  private unloadQuietly(section: Section): void {
    try {
      section.unload();
    } catch {
      // nothing to free
    }
  }

  private isCfi(target: unknown): boolean {
    return typeof target === "string" && target.startsWith("epubcfi(");
  }

  /** Display `target`, then settle on it. All programmatic moves go here. */
  private async show(target: string | number | undefined): Promise<void> {
    const rendition = this.rendition;
    if (!rendition) return;
    const token = ++this.navToken;
    this.settling = true;
    if (typeof target === "string" && this.isCfi(target)) this.anchor = target;
    this.veil(true);
    try {
      await rendition.display(target as string | undefined);
      if (token !== this.navToken) return;
      await this.settle(target, token);
    } catch {
      // an unresolvable target leaves the reader where they were
    } finally {
      if (token === this.navToken) {
        this.settling = false;
        this.veil(false);
        const location = this.currentLocation();
        if (location) {
          // Keep the intended passage as the anchor: re-deriving it from the
          // page start on every resize would walk the reader backwards.
          if (!this.isCfi(target) || !this.anchor) this.anchor = location.start.cfi;
          this.announce(location);
        }
      }
    }
  }

  private async settle(target: string | number | undefined, token: number): Promise<void> {
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
      await this.layoutQuiet();
      const rendition = this.rendition;
      if (token !== this.navToken || !rendition) return;
      if (typeof target !== "string" || !this.isCfi(target)) {
        // an href with a fragment is positioned once more after layout
        if (attempt === 0 && typeof target === "string" && target.includes("#")) {
          await rendition.display(target);
          continue;
        }
        return;
      }
      if (this.isOnVisiblePage(target)) return;
      await rendition.display(target);
      if (token !== this.navToken) return;
    }
  }

  /** Wait for fonts and two frames, then make epub.js re-measure the view. */
  private async layoutQuiet(): Promise<void> {
    const fonts = this.liveContents().map((c) => c.document.fonts?.ready);
    await Promise.race([Promise.all(fonts), delay(FONT_WAIT_MS)]);
    await nextFrame();
    for (const contents of this.liveContents()) {
      try {
        (contents as unknown as { expand?: () => void }).expand?.();
      } catch {
        // measurement hiccups must never break reading
      }
    }
    await nextFrame();
  }

  private isOnVisiblePage(cfi: string): boolean {
    const stage = this.stage();
    if (!stage || stage.clientWidth <= 0) return true;
    try {
      const parsed = new EpubCFI(cfi);
      const contents = this.contentsFor(parsed.spinePos);
      if (!contents) return false;
      const range = contents.range(cfi);
      if (!range) return true;
      let rect: DOMRect | undefined;
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const probe = range.cloneRange();
        const length = (node as Text).data.length;
        if (probe.collapsed && range.startOffset < length) {
          probe.setEnd(node, range.startOffset + 1);
        }
        rect = probe.getClientRects()[0] ?? probe.getBoundingClientRect();
      } else {
        const el = (node.childNodes[range.startOffset] ?? node) as Element;
        rect = el.getBoundingClientRect?.() ?? range.getBoundingClientRect();
      }
      if (!rect || (rect.width === 0 && rect.height === 0)) return true;
      const expected = pageStartFor(rect.left, stage.clientWidth, stage.scrollWidth);
      return Math.abs(stage.scrollLeft - expected) <= 2;
    } catch {
      return true;
    }
  }

  private async handleResize(): Promise<void> {
    const container = this.container;
    const rendition = this.rendition;
    if (!container || !rendition) return;
    const box = pageBoxOf(container);
    if (!box || (box.width === this.size.width && box.height === this.size.height)) return;
    this.size = box;
    const anchor = this.anchor;
    // epub.js rebuilds its views on resize; nothing it reports until we have
    // re-anchored is the reader's real position.
    this.settling = true;
    try {
      (rendition as unknown as { resize: (w: number, h: number, cfi?: string) => void }).resize(
        box.width,
        box.height,
        anchor ?? undefined,
      );
    } catch {
      // never let a resize hiccup break reading
    }
    if (anchor) await this.show(anchor);
    else this.settling = false;
  }

  /** Re-anchor after a change that reflows text in place. */
  private reanchor(): void {
    if (this.anchor && this.rendition) void this.show(this.anchor);
  }

  private cancelSettle(): void {
    this.navToken += 1;
    if (this.settling) {
      this.settling = false;
      this.veil(false);
    }
  }

  async next(): Promise<void> {
    this.cancelSettle();
    await this.rendition?.next();
  }

  async prev(): Promise<void> {
    this.cancelSettle();
    await this.rendition?.prev();
  }

  // ---- styling ----

  applyTypography(t: TypographySettings): void {
    const previous = this.typography;
    this.typography = t;
    const changed =
      !previous ||
      previous.fontSizePx !== t.fontSizePx ||
      previous.lineHeight !== t.lineHeight ||
      previous.fontFamily !== t.fontFamily;
    if (!changed) return;
    this.refreshTheme();
    this.reanchor();
  }

  applyTheme(theme: ThemeName): void {
    if (theme === this.theme) return;
    this.theme = theme;
    // Colors do not move text; no re-anchoring needed.
    this.refreshTheme();
  }

  applyPublisherStyles(enabled: boolean): void {
    if (enabled === this.publisherStyles) return;
    this.publisherStyles = enabled;
    this.refreshTheme();
    this.reanchor();
  }

  private readingFamily(): string {
    return this.language && stackFor(this.language) !== stackFor(null)
      ? stackFor(this.language)
      : (this.typography?.fontFamily ?? "Georgia, serif");
  }

  private imageMaxHeight(): number {
    return Math.max(120, this.size.height - IMAGE_MARGIN_PX);
  }

  /** The complete reading stylesheet for a chapter document. */
  private themeCss(): string {
    const palette = themes[this.theme];
    const lineHeight = this.typography?.lineHeight ?? 1.58;
    const fontSize = this.typography?.fontSizePx ?? 20;
    const dark = this.theme !== "paper";
    // An image is one unbreakable box. Left alone, one taller than the page
    // is sliced across columns and one wider spills into the next page, so
    // every image is fitted inside a single page and kept whole.
    const media = `
      img, svg, video, canvas {
        max-width: 100% !important;
        max-height: ${this.imageMaxHeight()}px !important;
        object-fit: contain;
        box-sizing: border-box;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      figure, table { max-width: 100% !important; break-inside: avoid; page-break-inside: avoid; }
      figure { margin-inline: 0; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; }
      img, svg, video { forced-color-adjust: none; }
    `;
    const base = `
      html { background: ${palette.page} !important; color-scheme: ${dark ? "dark" : "light"}; }
      body {
        background: ${palette.page} !important;
        color: ${palette.textPrimary} !important;
        font-family: ${this.readingFamily()} !important;
        font-size: ${fontSize}px !important;
        line-height: ${lineHeight} !important;
        overflow-wrap: break-word;
      }
      a { color: ${palette.accent} !important; text-decoration: underline; text-underline-offset: 2px; }
      ::selection { background: ${palette.selection}; }
      ${media}
    `;
    if (this.publisherStyles && this.theme === "paper") return base;
    // A publisher/Calibre wrapper often ships its own light background and
    // dark text; in Reader style only html/body carry the page colors.
    return `${base}
      * { background-color: transparent !important; }
      body * { color: inherit !important; }
      a, a * { color: ${palette.accent} !important; }
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
    `;
  }

  private makeThemeUrl(): string {
    return URL.createObjectURL(new Blob([this.themeCss()], { type: "text/css" }));
  }

  private createLink(doc: Document, id: string, href: string): HTMLLinkElement {
    const link = doc.createElementNS(XHTML_NS, "link") as HTMLLinkElement;
    link.setAttribute("id", id);
    link.setAttribute("rel", "stylesheet");
    link.setAttribute("type", "text/css");
    link.setAttribute("href", href);
    return link;
  }

  /**
   * Prepare a parsed chapter before epub.js writes it into an iframe.
   *
   * The packaged app's CSP carries a nonce, which makes browsers ignore
   * 'unsafe-inline': inline <style> blocks and style="" attributes inside
   * the chapter are parsed and then silently not applied. Stylesheets from
   * our own origin and blob: URLs are allowed, and CSSOM writes are never
   * subject to CSP, so publisher styles are moved onto those two channels
   * and our own reading styles ride the first one.
   */
  private prepareDocument(doc: Document, section: Section): void {
    try {
      const root = doc.documentElement;
      if (!root) return;
      const substitute = (css: string): string => {
        try {
          return this.book?.resources?.substitute(css, section.url) ?? css;
        } catch {
          return css;
        }
      };

      for (const style of Array.from(doc.querySelectorAll("style"))) {
        const css = style.textContent ?? "";
        if (!css.trim()) {
          style.remove();
          continue;
        }
        const url = URL.createObjectURL(new Blob([substitute(css)], { type: "text/css" }));
        this.ownedUrls.add(url);
        const link = this.createLink(doc, "", url);
        link.removeAttribute("id");
        const media = style.getAttribute("media");
        if (media) link.setAttribute("media", media);
        style.replaceWith(link);
      }

      for (const el of Array.from(doc.querySelectorAll("[style]"))) {
        const value = el.getAttribute("style");
        el.removeAttribute("style");
        if (value?.trim()) el.setAttribute(PARKED_STYLE_ATTR, substitute(value));
      }

      let head = doc.querySelector("head");
      if (!head) {
        head = doc.createElementNS(XHTML_NS, "head");
        root.insertBefore(head, root.firstChild);
      }
      if (!doc.getElementById(FONTS_LINK_ID)) {
        head.appendChild(
          this.createLink(doc, FONTS_LINK_ID, `${window.location.origin}/reader-fonts.css`),
        );
      }
      // Last in the head so it follows every publisher stylesheet.
      doc.getElementById(THEME_LINK_ID)?.remove();
      if (this.themeUrl) head.appendChild(this.createLink(doc, THEME_LINK_ID, this.themeUrl));
    } catch {
      // a chapter we could not prepare still renders; live styles cover it
    }
  }

  /**
   * CSSOM pass over a live chapter: restore parked publisher styles, then
   * apply the load-bearing theme and image rules. Idempotent, and immune to
   * CSP, so the page is themed even if a stylesheet were ever refused.
   */
  private applyLiveStyles(doc: Document): void {
    try {
      const html = doc?.documentElement;
      if (!html) return;
      for (const el of Array.from(doc.querySelectorAll<HTMLElement>(`[${PARKED_STYLE_ATTR}]`))) {
        const value = el.getAttribute(PARKED_STYLE_ATTR) ?? "";
        el.removeAttribute(PARKED_STYLE_ATTR);
        if (el.style) el.style.cssText = `${value};${el.style.cssText}`;
      }

      const palette = themes[this.theme];
      const dark = this.theme !== "paper";
      html.style.setProperty("background", palette.page, "important");
      html.style.colorScheme = dark ? "dark" : "light";
      const body = doc.body;
      if (body) {
        body.style.setProperty("background", palette.page, "important");
        body.style.setProperty("color", palette.textPrimary, "important");
        body.style.setProperty("font-family", this.readingFamily(), "important");
        body.style.setProperty("font-size", `${this.typography?.fontSizePx ?? 20}px`, "important");
        body.style.setProperty(
          "line-height",
          String(this.typography?.lineHeight ?? 1.58),
          "important",
        );
      }
      const maxHeight = `${this.imageMaxHeight()}px`;
      for (const el of Array.from(
        doc.querySelectorAll<HTMLElement | SVGElement>("img, svg, video, canvas"),
      )) {
        if (el.parentElement?.closest("svg")) continue; // inner SVG nodes follow their root
        el.style.setProperty("max-width", "100%", "important");
        el.style.setProperty("max-height", maxHeight, "important");
        el.style.setProperty("object-fit", "contain");
        el.style.setProperty("break-inside", "avoid");
      }
    } catch {
      // never let a styling poke break reading
    }
  }

  /** Swap in a freshly built reading stylesheet everywhere it is linked. */
  private refreshTheme(): void {
    const previous = this.themeUrl;
    this.themeUrl = this.makeThemeUrl();
    const next = this.themeUrl;

    const stage = this.container?.querySelector("iframe");
    if (stage) stage.style.background = themes[this.theme].page;

    // Loaded-but-not-displayed chapters are serialized again when shown.
    this.eachSection((section) => {
      section.document?.getElementById(THEME_LINK_ID)?.setAttribute("href", next);
    });

    for (const contents of this.liveContents()) {
      const doc = contents.document;
      this.applyLiveStyles(doc);
      const old = doc.getElementById(THEME_LINK_ID);
      const head = doc.querySelector("head");
      if (!head) continue;
      // Add the new sheet first and drop the old one once it has loaded, so
      // the page is never unstyled in between.
      const link = this.createLink(doc, THEME_LINK_ID, next);
      old?.removeAttribute("id");
      const drop = () => old?.remove();
      link.addEventListener("load", drop, { once: true });
      link.addEventListener("error", drop, { once: true });
      head.appendChild(link);
    }

    if (previous) window.setTimeout(() => URL.revokeObjectURL(previous), 4000);
  }

  destroy(): void {
    this.navToken += 1;
    if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    try {
      this.rendition?.destroy();
      this.book?.destroy();
    } catch {
      // destruction must never throw into the shell
    }
    for (const url of this.ownedUrls) URL.revokeObjectURL(url);
    this.ownedUrls.clear();
    if (this.themeUrl) URL.revokeObjectURL(this.themeUrl);
    this.themeUrl = null;
    this.rendition = null;
    this.book = null;
    this.args = null;
  }

  async toc(): Promise<TocEntry[]> {
    const nav = await this.book?.loaded.navigation;
    const out: TocEntry[] = [];
    const walk = (items: NavNode[], depth: number) => {
      for (const item of items) {
        out.push({ label: item.label.trim(), target: item.href, depth });
        if (Array.isArray(item.subitems) && item.subitems.length > 0) {
          walk(item.subitems, depth + 1);
        }
      }
    };
    if (nav?.toc) walk(nav.toc, 0);
    return out;
  }

  async goTo(target: string): Promise<void> {
    await this.show(target);
  }

  /** Search every spine section (loaded transiently, then unloaded). */
  async search(query: string): Promise<SearchHit[]> {
    const book = this.book;
    if (!book || query.trim().length < 2) return [];
    const hits: SearchHit[] = [];
    const sections: Section[] = [];
    this.eachSection((s) => sections.push(s));
    for (const section of sections) {
      const wasLoaded = Boolean(section.document);
      try {
        // typed as non-thenable but returns a promise at runtime
        await Promise.resolve(section.load(book.load.bind(book)));
        const found = section.find(query) as unknown as { cfi: string; excerpt: string }[];
        const title = this.titleForSpine(section.index);
        for (const f of found) {
          hits.push({ target: f.cfi, excerpt: f.excerpt, sectionTitle: title });
        }
      } catch {
        // a malformed section must not break search
      } finally {
        if (!wasLoaded && !this.contentsFor(section.index)) this.unloadQuietly(section);
      }
      if (hits.length >= 200) break; // keep the panel calm and bounded
    }
    return hits;
  }

  /** Plain text by chapter, read straight from the archive. */
  async extractText(): Promise<BookTextSection[]> {
    const book = this.book;
    if (!book) return [];
    const sections: Section[] = [];
    this.eachSection((s) => sections.push(s));
    const texts: string[] = new Array<string>(sections.length).fill("");
    for (const section of sections) {
      if (this.book !== book) return [];
      try {
        const doc = (await book.load(section.url)) as unknown as Document;
        const body = doc?.body ?? doc?.documentElement;
        if (body) {
          const clone = body.cloneNode(true) as Element;
          clone.querySelectorAll("script, style").forEach((el) => el.remove());
          // keep paragraph boundaries so local chunking can respect them
          clone
            .querySelectorAll("p, div, h1, h2, h3, h4, h5, h6, li, blockquote, br, tr")
            .forEach((el) => el.append("\n"));
          texts[section.index] = (clone.textContent ?? "")
            .replace(/[ \t\f\v]+/gu, " ")
            .replace(/\s*\n\s*/gu, "\n")
            .trim();
        }
      } catch {
        // an unreadable section contributes nothing
      }
      await delay(0);
    }
    return this.runs.map((run, index) => ({
      index,
      title: run.title,
      text: texts
        .slice(run.start, run.end)
        .filter((t) => t.length > 0)
        .join("\n"),
    }));
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
