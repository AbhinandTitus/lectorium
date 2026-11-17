import { takeGraphemes, type TextQuote } from "../locator";

/**
 * Pure helpers for the EPUB engine: geometry and text-anchor arithmetic
 * that can be unit-tested without epub.js or a real layout.
 */

/** A chapter: the spine items from one titled entry up to the next. */
export interface ChapterRun {
  /** first spine index (inclusive) */
  start: number;
  /** end spine index (exclusive) */
  end: number;
  title: string | null;
}

/**
 * Group spine items into chapters. `titles[i]` is the table-of-contents
 * label that opens spine item `i`, or null when the file merely continues
 * the chapter before it (publishers often split one chapter across files).
 * Untitled front matter becomes a run of its own.
 */
export function chapterRuns(titles: (string | null)[]): ChapterRun[] {
  const runs: ChapterRun[] = [];
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    if (title !== null || runs.length === 0) {
      runs.push({ start: i, end: i + 1, title });
    } else {
      runs[runs.length - 1].end = i + 1;
    }
  }
  return runs;
}

/** The content box of the page host: what a page can actually occupy. */
export function pageBoxOf(el: HTMLElement): { width: number; height: number } | null {
  const style = getComputedStyle(el);
  const pad = (value: string) => Number.parseFloat(value) || 0;
  const width = Math.floor(el.clientWidth - pad(style.paddingLeft) - pad(style.paddingRight));
  const height = Math.floor(el.clientHeight - pad(style.paddingTop) - pad(style.paddingBottom));
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Scroll offset of the page that contains horizontal position `left`,
 * clamped to the last full page (mirrors epub.js's own page arithmetic).
 */
export function pageStartFor(left: number, pageWidth: number, scrollWidth: number): number {
  if (pageWidth <= 0) return 0;
  // +1 guards against sub-pixel rects that sit a hair before a boundary
  const start = Math.floor((Math.max(0, left) + 1) / pageWidth) * pageWidth;
  const last = Math.max(0, scrollWidth - pageWidth);
  return Math.min(start, last);
}

function bodyOf(range: Range): HTMLElement | null {
  return range.startContainer.ownerDocument?.body ?? null;
}

/** Character offset of the range start within its document's body text. */
function offsetInBody(range: Range, body: HTMLElement): number {
  const before = range.cloneRange();
  before.selectNodeContents(body);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

/**
 * Text-quote anchor for a collapsed position (the top of a page): the next
 * 32 graphemes of visible text, with context on both sides.
 */
export function collapsedQuoteAt(range: Range): TextQuote | null {
  const body = bodyOf(range);
  if (!body) return null;
  const full = body.textContent ?? "";
  const from = offsetInBody(range, body);
  const leading = full.substring(from).search(/\S/u);
  if (leading === -1) return null;
  const start = from + leading;
  const exact = takeGraphemes(full.substring(start), 32);
  if (!exact.trim()) return null;
  return {
    exact,
    prefix: takeGraphemes(full.substring(0, start), 64, true),
    suffix: takeGraphemes(full.substring(start + exact.length), 64),
  };
}

/**
 * Does `range` still point at the quoted words? True when the text that
 * begins at the range start (ignoring leading whitespace) starts with
 * `exact` — the page-top case, where the range is collapsed — or when a
 * spanning range contains it, as annotation ranges do.
 */
export function textStartsWith(range: Range, exact: string): boolean {
  if (!exact) return true;
  if (!range.collapsed && range.toString().includes(exact)) return true;
  const body = bodyOf(range);
  if (!body) return false;
  const full = body.textContent ?? "";
  const from = offsetInBody(range, body);
  const leading = full.substring(from).search(/\S/u);
  if (leading === -1) return false;
  return full.startsWith(exact, from + leading);
}

/**
 * Find a quote in `full`, preferring the occurrence whose surrounding text
 * matches the stored prefix and suffix. Returns the offset of `exact`.
 */
export function findQuoteOffset(full: string, quote: TextQuote): number | null {
  if (!quote.exact) return null;
  let best: { at: number; score: number } | null = null;
  let from = 0;
  while (from <= full.length) {
    const at = full.indexOf(quote.exact, from);
    if (at === -1) break;
    const before = full.substring(Math.max(0, at - quote.prefix.length), at);
    const after = full.substring(
      at + quote.exact.length,
      at + quote.exact.length + quote.suffix.length,
    );
    const score =
      Number(quote.prefix.length > 0 && before.endsWith(quote.prefix)) +
      Number(quote.suffix.length > 0 && after.startsWith(quote.suffix));
    if (!best || score > best.score) best = { at, score };
    if (score === 2) break;
    from = at + Math.max(1, quote.exact.length);
  }
  return best ? best.at : null;
}

/**
 * Map a character offset in `root.textContent` to a text node and offset.
 * An offset on a node boundary resolves to the START of the following
 * node, never the end of the previous one: the previous node is often
 * inter-paragraph whitespace, and a position there belongs to the page
 * before.
 */
export function locateOffset(root: Node, offset: number): { node: Text; offset: number } | null {
  const doc = root.ownerDocument;
  if (!doc) return null;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let last: Text | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const length = node.data.length;
    if (offset < consumed + length) return { node, offset: offset - consumed };
    consumed += length;
    last = node;
  }
  return last && offset === consumed ? { node: last, offset: last.data.length } : null;
}
