import { describe, expect, it } from "vitest";
import { sanitizeTextHtml } from "./textEngine";

describe("sanitizeTextHtml", () => {
  it("removes active elements, styles and unapproved attributes", () => {
    const out = sanitizeTextHtml(
      `<style>body{display:none}</style><form><input value="x"></form>` +
        `<p id="shell" style="position:fixed" onclick="bad()">Safe text</p>` +
        `<svg onload="bad()"><text>unsafe vector</text></svg>`,
    );
    expect(out).toContain("Safe text");
    expect(out).not.toMatch(/style=|onclick|<style|<form|<input|<svg/i);
  });

  it("keeps semantic callouts and neutralizes external links", () => {
    const out = sanitizeTextHtml(
      `<aside class="anecdote box">A story</aside>` +
        `<a href="https://example.com/path">source</a>`,
    );
    const doc = new DOMParser().parseFromString(out, "text/html");
    expect(doc.querySelector("aside")?.classList.contains("book-callout")).toBe(true);
    expect(doc.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(doc.querySelector("a")?.getAttribute("data-external-href")).toBe(
      "https://example.com/path",
    );
  });

  it("preserves Malayalam and direction metadata", () => {
    const text = "ക്ലിപ്തമായ സന്ധ്യയിൽ";
    const out = sanitizeTextHtml(`<p lang="ml" dir="ltr">${text}</p>`);
    expect(out).toContain(text);
    expect(out).toContain('lang="ml"');
  });
});
