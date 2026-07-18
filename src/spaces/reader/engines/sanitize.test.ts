import { describe, expect, it } from "vitest";
import { sanitizeChapter } from "./epubEngine";

describe("sanitizeChapter (ADR 0005 — hostile publications render inert)", () => {
  it("removes script tags entirely", () => {
    const out = sanitizeChapter(`<p>ok</p><script>window.x=1</script>`);
    expect(out).not.toContain("<script");
    expect(out).toContain("ok");
  });

  it("strips inline event handlers and javascript: URLs", () => {
    const out = sanitizeChapter(`<p onmouseover="x()">t</p><a href="javascript:alert(1)">link</a>`);
    expect(out).not.toContain("onmouseover");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("link");
  });

  it("removes remote images, stylesheets and css beacons", () => {
    const out = sanitizeChapter(
      `<img src="https://attacker.invalid/b.png"/>` +
        `<link rel="stylesheet" href="//attacker.invalid/s.css"/>` +
        `<style>@import url("https://attacker.invalid/s.css"); p { background: url('https://attacker.invalid/x') }</style>` +
        `<p style="background:url(https://attacker.invalid/y)">t</p>`,
    );
    expect(out).not.toContain("attacker.invalid");
  });

  it("keeps internal, blob: and data: resources", () => {
    const out = sanitizeChapter(
      `<img src="images/cover.jpg"/><img src="blob:null/abc"/><img src="data:image/png;base64,AA"/>`,
    );
    expect(out).toContain("images/cover.jpg");
    expect(out).toContain("blob:null/abc");
    expect(out).toContain("data:image/png");
  });

  it("neutralizes external links but keeps their text", () => {
    const out = sanitizeChapter(`<a href="https://example.com/page">read this</a>`);
    const a = new DOMParser().parseFromString(out, "text/html").querySelector("a");
    expect(a?.hasAttribute("href")).toBe(false);
    expect(a?.getAttribute("data-external-href")).toBe("https://example.com/page");
    expect(a?.textContent).toBe("read this");
  });

  it("preserves Malayalam text unchanged", () => {
    const ml = "ക്ലിപ്തമായ സന്ധ്യയിൽ, കാറ്റ് ജനാലയ്ക്കരികിൽ";
    const out = sanitizeChapter(`<p>${ml}</p><script>bad()</script>`);
    expect(out).toContain(ml);
  });
});
