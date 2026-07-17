/**
 * Design tokens — single source of truth for both themes.
 *
 * These objects are applied to `:root` as CSS custom properties by
 * `applyTheme`, and are imported directly by the automated contrast
 * test, so the tested values are always the shipped values.
 *
 * Constraints (docs/PRODUCT.md):
 * - never pure #000 or #FFF
 * - no bright saturated blue at night; focus outlines are warm
 * - Ember is low-luminance; no surface in the night flow may flash bright
 */

export type ThemeName = "paper" | "ember";

export interface ThemeTokens {
  /** window / app surround behind the page */
  surround: string;
  /** the page the text sits on */
  page: string;
  /** raised surfaces: sheets, drawers, popovers */
  raised: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  selection: string;
  hairline: string;
  /** focus outline — warm, never saturated blue */
  focus: string;
}

export const themes: Record<ThemeName, ThemeTokens> = {
  paper: {
    surround: "#D8D0C3",
    page: "#F3EBDD",
    raised: "#EFE6D6",
    textPrimary: "#2C2823",
    textSecondary: "#6E645A",
    accent: "#7A4E2D",
    selection: "#D9BE9A",
    hairline: "#C4BAAB",
    focus: "#7A4E2D",
  },
  ember: {
    surround: "#12100E",
    page: "#12100E",
    raised: "#191611",
    textPrimary: "#C8BBA8",
    textSecondary: "#8F8372",
    accent: "#B18452",
    selection: "#5A452D",
    hairline: "#2A241D",
    focus: "#B18452",
  },
};

/** Non-color shared tokens. */
export const metrics = {
  radiusSmall: "6px",
  radiusLarge: "12px",
  chromeFadeMs: 2500,
  pageTurnMs: 150, // within the specified 120–180ms band
} as const;

const cssVarMap: Record<keyof ThemeTokens, string> = {
  surround: "--color-surround",
  page: "--color-page",
  raised: "--color-raised",
  textPrimary: "--color-text-primary",
  textSecondary: "--color-text-secondary",
  accent: "--color-accent",
  selection: "--color-selection",
  hairline: "--color-hairline",
  focus: "--color-focus",
};

export function applyTheme(name: ThemeName, root: HTMLElement = document.documentElement): void {
  const theme = themes[name];
  for (const key of Object.keys(cssVarMap) as (keyof ThemeTokens)[]) {
    root.style.setProperty(cssVarMap[key], theme[key]);
  }
  root.dataset.theme = name;
}
