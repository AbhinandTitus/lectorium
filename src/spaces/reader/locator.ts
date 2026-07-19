/**
 * Engine-agnostic locator envelopes (ADR 0004). Every stored position uses
 * redundant anchors: engine-native `primary`, engine-independent
 * `textQuote` (filled by annotation flows from M2), and human `coarse`.
 * Never store a bare CFI, percentage, or page number.
 */

export interface TextQuote {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface EpubPrimary {
  cfi: string;
  spineIndex: number;
  href: string;
}

export interface PdfPrimary {
  pageIndex: number;
  pageLabel: string | null;
  /** normalized [0..1] position within the page, top-left origin */
  x: number;
  y: number;
}

export interface TextPrimary {
  blockIndex: number;
  charOffset: number;
}

export interface CoarseAnchor {
  sectionTitle: string | null;
  spineIndex?: number;
  pageIndex?: number;
  blockIndex?: number;
  /** hidden from all UI; resume-of-last-resort only */
  progress?: number;
}

export type LocatorEnvelope =
  | {
      v: 1;
      engine: "epub";
      primary: EpubPrimary;
      textQuote: TextQuote | null;
      coarse: CoarseAnchor;
    }
  | { v: 1; engine: "pdf"; primary: PdfPrimary; textQuote: TextQuote | null; coarse: CoarseAnchor }
  | {
      v: 1;
      engine: "text";
      primary: TextPrimary;
      textQuote: TextQuote | null;
      coarse: CoarseAnchor;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function validQuote(value: unknown): value is TextQuote | null {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value.exact === "string" &&
      typeof value.prefix === "string" &&
      typeof value.suffix === "string")
  );
}

function validCoarse(value: unknown): value is CoarseAnchor {
  if (!isRecord(value)) return false;
  if (value.sectionTitle !== null && typeof value.sectionTitle !== "string") return false;
  for (const key of ["spineIndex", "pageIndex", "blockIndex"] as const) {
    if (value[key] !== undefined && !isNonNegativeInteger(value[key])) return false;
  }
  return (
    value.progress === undefined ||
    (isFiniteNumber(value.progress) && value.progress >= 0 && value.progress <= 1)
  );
}

export function parseEnvelope(json: string): LocatorEnvelope | null {
  try {
    const value: unknown = JSON.parse(json);
    if (
      !isRecord(value) ||
      value.v !== 1 ||
      !validQuote(value.textQuote) ||
      !validCoarse(value.coarse)
    )
      return null;
    if (!isRecord(value.primary)) return null;
    if (
      value.engine === "epub" &&
      typeof value.primary.cfi === "string" &&
      isNonNegativeInteger(value.primary.spineIndex) &&
      typeof value.primary.href === "string"
    )
      return value as unknown as LocatorEnvelope;
    if (
      value.engine === "pdf" &&
      isNonNegativeInteger(value.primary.pageIndex) &&
      (value.primary.pageLabel === null || typeof value.primary.pageLabel === "string") &&
      isFiniteNumber(value.primary.x) &&
      value.primary.x >= 0 &&
      value.primary.x <= 1 &&
      isFiniteNumber(value.primary.y) &&
      value.primary.y >= 0 &&
      value.primary.y <= 1
    )
      return value as unknown as LocatorEnvelope;
    if (
      value.engine === "text" &&
      isNonNegativeInteger(value.primary.blockIndex) &&
      isNonNegativeInteger(value.primary.charOffset)
    )
      return value as unknown as LocatorEnvelope;
    return null;
  } catch {
    return null;
  }
}

export function serializeEnvelope(envelope: LocatorEnvelope): string {
  return JSON.stringify(envelope);
}

/** Split at grapheme boundaries so Malayalam and other combining scripts are never sliced. */
export function graphemes(text: string): string[] {
  const intl = Intl as typeof Intl & {
    Segmenter?: new (
      locales?: string | string[],
      options?: { granularity: "grapheme" },
    ) => { segment: (value: string) => Iterable<{ segment: string }> };
  };
  if (typeof intl.Segmenter === "function") {
    const segmenter = new intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (part) => part.segment);
  }
  const out: string[] = [];
  for (const point of Array.from(text)) {
    const attach = /\p{Mark}|\u200d|\ufe0f/u.test(point) || out[out.length - 1]?.endsWith("\u200d");
    if (attach && out.length > 0) out[out.length - 1] += point;
    else out.push(point);
  }
  return out;
}

export function takeGraphemes(text: string, count: number, fromEnd = false): string {
  const parts = graphemes(text);
  return (fromEnd ? parts.slice(-count) : parts.slice(0, count)).join("");
}

export function quoteContext(
  fullText: string,
  startOffset: number,
  endOffset: number,
  contextLength = 48,
): TextQuote {
  return {
    exact: fullText.substring(startOffset, endOffset),
    prefix: takeGraphemes(fullText.substring(0, startOffset), contextLength, true),
    suffix: takeGraphemes(fullText.substring(endOffset), contextLength),
  };
}

export function excerptAround(
  fullText: string,
  startOffset: number,
  matchLength: number,
  contextLength = 40,
): string {
  const before = takeGraphemes(fullText.substring(0, startOffset), contextLength, true);
  const match = fullText.substring(startOffset, startOffset + matchLength);
  const after = takeGraphemes(fullText.substring(startOffset + matchLength), contextLength);
  return `${before.length < startOffset ? "…" : ""}${before}${match}${after}${
    after.length < fullText.length - startOffset - matchLength ? "…" : ""
  }`;
}
