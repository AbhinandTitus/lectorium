import { describe, expect, it } from "vitest";
import { applyTheme, themes, type ThemeName } from "./tokens";

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a 6-digit hex color: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const themeNames = Object.keys(themes) as ThemeName[];

for (const name of themeNames) {
  describe(`theme ${name}`, () => {
    const t = themes[name];

    it("meets WCAG AA (4.5:1) for primary text on every reading surface", () => {
      for (const surface of [t.page, t.raised, t.selection]) {
        expect(contrast(t.textPrimary, surface)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("meets WCAG AA (4.5:1) for secondary text on page and raised", () => {
      for (const surface of [t.page, t.raised]) {
        expect(contrast(t.textSecondary, surface)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("meets 4.5:1 for accent used as text on page and raised", () => {
      for (const surface of [t.page, t.raised]) {
        expect(contrast(t.accent, surface)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("meets non-text contrast (3:1) for the focus outline against its surfaces", () => {
      for (const surface of [t.page, t.raised, t.surround]) {
        expect(contrast(t.focus, surface)).toBeGreaterThanOrEqual(3);
      }
    });

    it("never uses pure black or pure white", () => {
      // interfaces have no implicit index signature, so Object.values is any[]
      for (const value of Object.values(t) as string[]) {
        expect(value.toLowerCase()).not.toBe("#000000");
        expect(value.toLowerCase()).not.toBe("#ffffff");
      }
    });
  });
}

describe("ember night constraints", () => {
  const ember = themes.ember;

  it("keeps every surface at low luminance (no bright frame possible)", () => {
    for (const surface of [ember.surround, ember.page, ember.raised]) {
      expect(luminance(surface)).toBeLessThan(0.02);
    }
  });

  it("keeps focus warm, not blue (blue channel not dominant)", () => {
    const m = /^#(..)(..)(..)$/.exec(ember.focus)!;
    const [r, , b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
    expect(b).toBeLessThan(r);
  });
});

describe("applyTheme", () => {
  it("writes every token as a CSS custom property and stamps data-theme", () => {
    const root = document.createElement("div");
    applyTheme("paper", root);
    expect(root.dataset.theme).toBe("paper");
    expect(root.style.getPropertyValue("--color-page")).toBe(themes.paper.page);
    const tokenCount = Object.keys(themes.paper).length;
    expect(root.style.length).toBe(tokenCount);
  });
});
