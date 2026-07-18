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

export function parseEnvelope(json: string): LocatorEnvelope | null {
  try {
    const value = JSON.parse(json) as Partial<LocatorEnvelope>;
    if (value && value.v === 1 && value.engine && value.primary) {
      return value as LocatorEnvelope;
    }
    return null;
  } catch {
    return null;
  }
}

export function serializeEnvelope(envelope: LocatorEnvelope): string {
  return JSON.stringify(envelope);
}
