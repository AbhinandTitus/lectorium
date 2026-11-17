import { describe, expect, it } from "vitest";
import {
  chapterRuns,
  collapsedQuoteAt,
  findQuoteOffset,
  locateOffset,
  pageStartFor,
  textStartsWith,
} from "./epubLayout";

function body(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return doc.body;
}

describe("chapterRuns", () => {
  it("joins untitled files to the chapter before them", () => {
    expect(chapterRuns([null, "One", null, null, "Two", "Three", null])).toEqual([
      { start: 0, end: 1, title: null },
      { start: 1, end: 4, title: "One" },
      { start: 4, end: 5, title: "Two" },
      { start: 5, end: 7, title: "Three" },
    ]);
  });

  it("treats a book without navigation as a single run", () => {
    expect(chapterRuns([null, null, null])).toEqual([{ start: 0, end: 3, title: null }]);
    expect(chapterRuns([])).toEqual([]);
  });
});

describe("pageStartFor", () => {
  it("returns the page that contains a position", () => {
    expect(pageStartFor(0, 600, 6000)).toBe(0);
    expect(pageStartFor(599.4, 600, 6000)).toBe(600); // sub-pixel before a boundary
    expect(pageStartFor(1300, 600, 6000)).toBe(1200);
  });

  it("clamps to the last full page and survives a zero width", () => {
    expect(pageStartFor(5990, 600, 6000)).toBe(5400);
    expect(pageStartFor(100, 0, 6000)).toBe(0);
  });
});

describe("findQuoteOffset", () => {
  const text = "She closed the book. Later, she closed the book again and slept.";

  it("prefers the occurrence whose context matches", () => {
    const first = findQuoteOffset(text, { exact: "closed the book", prefix: "She ", suffix: "." });
    const second = findQuoteOffset(text, {
      exact: "closed the book",
      prefix: "she ",
      suffix: " again",
    });
    expect(first).toBe(4);
    expect(second).toBe(text.lastIndexOf("closed the book"));
  });

  it("returns null when the words are gone", () => {
    expect(findQuoteOffset(text, { exact: "opened", prefix: "", suffix: "" })).toBeNull();
    expect(findQuoteOffset(text, { exact: "", prefix: "", suffix: "" })).toBeNull();
  });
});

describe("locateOffset", () => {
  it("resolves a boundary to the start of the next text node", () => {
    const root = body("<p>First.</p>\n<p>Second paragraph.</p>");
    const full = root.textContent ?? "";
    const at = locateOffset(root, full.indexOf("Second"));
    expect(at?.node.data).toBe("Second paragraph.");
    expect(at?.offset).toBe(0);
  });

  it("finds positions inside a node and at the very end", () => {
    const root = body("<p>First.</p><p>Second.</p>");
    expect(locateOffset(root, 2)).toMatchObject({ offset: 2 });
    const end = locateOffset(root, (root.textContent ?? "").length);
    expect(end?.node.data).toBe("Second.");
    expect(end?.offset).toBe(7);
    expect(locateOffset(root, 999)).toBeNull();
  });
});

describe("text quotes at the top of a page", () => {
  it("anchors a collapsed position to the words that follow it", () => {
    const root = body(
      "<p>First paragraph ends here.</p>\n  <p>മീരയുടെ മേശപ്പുറത്ത് ഒരു വിളക്ക്.</p>",
    );
    const range = root.ownerDocument.createRange();
    range.setStart(root.childNodes[1], 0); // whitespace between paragraphs
    range.collapse(true);
    const quote = collapsedQuoteAt(range);
    expect(quote?.exact.startsWith("മീരയുടെ")).toBe(true);
    expect(quote?.prefix.endsWith("here.\n  ")).toBe(true);
    // a stored quote verifies against the same position, whitespace and all
    expect(textStartsWith(range, quote?.exact ?? "")).toBe(true);
    expect(textStartsWith(range, "First paragraph")).toBe(false);
  });

  it("accepts a spanning range that contains the quote", () => {
    const root = body("<p>She set the lamp down and read on.</p>");
    const text = root.querySelector("p")!.firstChild!;
    const range = root.ownerDocument.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 21);
    expect(textStartsWith(range, "the lamp")).toBe(true);
  });
});
