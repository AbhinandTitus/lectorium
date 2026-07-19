import { describe, expect, it } from "vitest";
import { excerptAround, parseEnvelope, quoteContext, takeGraphemes } from "./locator";

describe("locator envelopes", () => {
  it("rejects incomplete and malformed stored positions", () => {
    expect(parseEnvelope("{}")).toBeNull();
    expect(
      parseEnvelope(
        JSON.stringify({
          v: 1,
          engine: "epub",
          primary: { cfi: 4, spineIndex: -1, href: "chapter.xhtml" },
          textQuote: null,
          coarse: { sectionTitle: null },
        }),
      ),
    ).toBeNull();
  });

  it("accepts a complete EPUB envelope", () => {
    const value = {
      v: 1,
      engine: "epub",
      primary: { cfi: "epubcfi(/6/2)", spineIndex: 0, href: "chapter.xhtml" },
      textQuote: null,
      coarse: { sectionTitle: "One", spineIndex: 0, progress: 0.1 },
    };
    expect(parseEnvelope(JSON.stringify(value))).toEqual(value);
  });
});

describe("grapheme-safe locator context", () => {
  it("does not split Malayalam grapheme clusters", () => {
    const cluster = "ക്ലി";
    expect(takeGraphemes(`${cluster}പ്ത`, 1)).toBe(cluster);
  });

  it("builds quote context and excerpts without breaking surrounding text", () => {
    const text = "ആദ്യം തിരഞ്ഞെടുത്ത വാക്ക് പിന്നീട്";
    const exact = "തിരഞ്ഞെടുത്ത";
    const at = text.indexOf(exact);
    expect(quoteContext(text, at, at + exact.length, 3).exact).toBe(exact);
    expect(excerptAround(text, at, exact.length, 3)).toContain(exact);
  });
});
