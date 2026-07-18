/**
 * Typography presets (docs/PRODUCT.md): coherent choices first, sliders
 * later. Reading text defaults to Literata; Malayalam content uses the
 * bundled Noto Malayalam families via script-aware stacks.
 */

export type PresetName = "focus" | "open" | "air";

export interface TypographySettings {
  fontSizePx: number;
  lineHeight: number;
  maxWidthCh: number;
  fontFamily: string;
}

export const READING_STACK_LATIN = `"Literata", Georgia, serif`;
export const READING_STACK_MALAYALAM = `"Noto Serif Malayalam", "Nirmala UI", serif`;

export const presets: Record<PresetName, TypographySettings> = {
  focus: { fontSizePx: 19, lineHeight: 1.48, maxWidthCh: 60, fontFamily: READING_STACK_LATIN },
  open: { fontSizePx: 20, lineHeight: 1.58, maxWidthCh: 66, fontFamily: READING_STACK_LATIN },
  air: { fontSizePx: 21, lineHeight: 1.68, maxWidthCh: 58, fontFamily: READING_STACK_LATIN },
};

export const FONT_SIZE_MIN = 16;
export const FONT_SIZE_MAX = 32;

/** Detect Malayalam content (language tag or Unicode block presence). */
export function isMalayalam(language: string | null, sampleText?: string): boolean {
  if (language && language.toLowerCase().startsWith("ml")) return true;
  if (sampleText) {
    for (const ch of sampleText.slice(0, 4000)) {
      const code = ch.codePointAt(0) ?? 0;
      if (code >= 0x0d00 && code <= 0x0d7f) return true;
    }
  }
  return false;
}

export function stackFor(language: string | null, sampleText?: string): string {
  return isMalayalam(language, sampleText) ? READING_STACK_MALAYALAM : READING_STACK_LATIN;
}
