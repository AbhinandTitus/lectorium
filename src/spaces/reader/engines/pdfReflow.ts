import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * Conservative PDF → reading-stream analysis (ADR 0003). Reflow is a
 * DERIVED VIEW, never a file conversion. We reconstruct paragraphs and
 * headings from PDF.js text items using column detection, baseline
 * clustering, font-size clusters, gap statistics, and text coverage.
 * When confidence is low we say so and default to Original page — we never
 * silently scramble a book.
 */

export interface ReflowBlock {
  kind: "heading" | "paragraph";
  text: string;
  /** source page (0-based) this block starts on — for cross-view locators */
  pageIndex: number;
}

export interface ReflowResult {
  blocks: ReflowBlock[];
  confidence: "high" | "low";
  /** why confidence is low, for the warning banner */
  reason: string | null;
  /** true when pages carried no extractable text (scanned / broken encoding) */
  textUnavailable: boolean;
  /** true when analysis stopped before the final source page */
  truncated: boolean;
}

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
}

const GARBLE_RATIO = 0.4; // fraction of replacement/control chars that means broken encoding

export async function analyzeReflow(doc: PDFDocumentProxy, maxPages = 400): Promise<ReflowResult> {
  const pageCount = Math.min(doc.numPages, maxPages);
  const truncated = pageCount < doc.numPages;
  const blocks: ReflowBlock[] = [];
  let anyText = false;
  let multiColumnPages = 0;
  let garbledPages = 0;
  const bodySizes: number[] = [];

  // first pass: gather items per page, collect global font-size distribution
  const perPage: Item[][] = [];
  for (let i = 0; i < pageCount; i++) {
    const page = await doc.getPage(i + 1);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || !raw.str) continue;
      const it = raw as { str: string; transform: number[]; width: number; height: number };
      const t = it.transform;
      const x = t[4];
      const y = viewport.height - t[5]; // flip to top-down
      const fontSize = Math.hypot(t[2], t[3]) || it.height || 10;
      items.push({ str: it.str, x, y, w: it.width, h: it.height, fontSize });
    }
    if (items.length > 0) anyText = true;
    if (isGarbled(items)) garbledPages++;
    perPage.push(items);
    for (const it of items) bodySizes.push(round(it.fontSize));
  }

  if (!anyText) {
    return {
      blocks: [],
      confidence: "low",
      reason: null,
      textUnavailable: true,
      truncated,
    };
  }

  const bodySize = mode(bodySizes);
  const headingThreshold = bodySize * 1.18;

  // second pass: group items into lines, lines into blocks
  for (let i = 0; i < perPage.length; i++) {
    const items = perPage[i];
    if (items.length === 0) continue;

    if (detectColumns(items) > 1) multiColumnPages++;

    const lines = groupLines(items);
    let paragraph: string[] = [];
    let paragraphSize = bodySize;

    const flush = () => {
      if (paragraph.length === 0) return;
      const text = paragraph.join(" ").replace(/\s+/g, " ").trim();
      if (text) {
        blocks.push({
          kind: paragraphSize >= headingThreshold ? "heading" : "paragraph",
          text,
          pageIndex: i,
        });
      }
      paragraph = [];
    };

    let prevBottom: number | null = null;
    for (const line of lines) {
      const lineSize = median(line.map((it) => it.fontSize));
      const top = Math.min(...line.map((it) => it.y));
      const text = line
        .sort((a, b) => a.x - b.x)
        .map((it) => it.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;

      const bigGap = prevBottom !== null && top - prevBottom > lineSize * 1.6;
      const sizeShift = Math.abs(lineSize - paragraphSize) > bodySize * 0.15;
      const isHeading = lineSize >= headingThreshold;

      if (isHeading || bigGap || sizeShift) {
        flush();
        paragraphSize = lineSize;
      }
      paragraph.push(text);
      if (isHeading) {
        // a heading is its own block
        paragraphSize = lineSize;
        flush();
      }
      prevBottom = Math.max(...line.map((it) => it.y + it.h));
    }
    flush();
  }

  const columnFraction = multiColumnPages / pageCount;
  const garbleFraction = garbledPages / pageCount;
  let confidence: "high" | "low" = "high";
  let reason: string | null = null;
  if (garbleFraction > 0.25) {
    confidence = "low";
    reason = "This PDF's text may be incorrectly encoded; reflowed text could be wrong.";
  } else if (columnFraction > 0.3) {
    confidence = "low";
    reason = "This PDF uses complex multi-column layout; reading order may be imperfect.";
  } else if (blocks.length < pageCount) {
    confidence = "low";
    reason = "Little structured text was found; reflow may be unreliable.";
  }

  if (truncated) {
    confidence = "low";
    reason = `Reflow analysis is limited to the first ${maxPages} pages of this PDF.`;
  }

  return { blocks, confidence, reason, textUnavailable: false, truncated };
}

function isGarbled(items: Item[]): boolean {
  let bad = 0;
  let total = 0;
  for (const it of items) {
    for (const ch of it.str) {
      total++;
      const code = ch.codePointAt(0) ?? 0;
      // replacement char, or control chars, or private-use area (common in
      // broken custom-encoded PDFs incl. some Malayalam)
      if (code === 0xfffd || (code < 0x20 && code !== 0x09) || (code >= 0xe000 && code <= 0xf8ff)) {
        bad++;
      }
    }
  }
  return total > 20 && bad / total > GARBLE_RATIO;
}

/** Cluster item x-starts to estimate column count (1 or 2 typical). */
function detectColumns(items: Item[]): number {
  if (items.length < 20) return 1;
  const xs = items.map((it) => it.x).sort((a, b) => a - b);
  const min = xs[0];
  const max = xs[xs.length - 1];
  if (max - min < 50) return 1;
  const mid = (min + max) / 2;
  const left = xs.filter((x) => x < mid - 40).length;
  const right = xs.filter((x) => x > mid + 40).length;
  // both halves substantially populated → likely two columns
  return left > items.length * 0.3 && right > items.length * 0.3 ? 2 : 1;
}

/** Group items sharing a baseline (within tolerance) into lines. */
function groupLines(items: Item[]): Item[][] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Item[][] = [];
  let current: Item[] = [];
  let lineY: number | null = null;
  for (const it of sorted) {
    const tol = Math.max(2, it.fontSize * 0.5);
    if (lineY === null || Math.abs(it.y - lineY) <= tol) {
      current.push(it);
      lineY = lineY === null ? it.y : (lineY + it.y) / 2;
    } else {
      lines.push(current);
      current = [it];
      lineY = it.y;
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

function round(n: number): number {
  return Math.round(n * 2) / 2;
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? 12;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
