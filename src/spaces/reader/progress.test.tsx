import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReadingProgress } from "./ReadingProgress";
import { epubReadingProgress, normalizeProgress, roundedProgressPercent } from "./progress";

describe("reading progress", () => {
  it("shows one calm rounded percentage", () => {
    render(<ReadingProgress progress={0.423} />);

    const meter = screen.getByRole("progressbar", { name: "42% read" });
    expect(meter).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("stays absent until the engine has a valid position", () => {
    const { container } = render(<ReadingProgress progress={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(normalizeProgress(Number.NaN)).toBeNull();
  });

  it("clamps engine rounding at the book boundaries", () => {
    expect(roundedProgressPercent(-0.2)).toBe(0);
    expect(roundedProgressPercent(1.2)).toBe(100);
  });

  it("uses EPUB's exact percentage when available", () => {
    expect(epubReadingProgress({ index: 4, percentage: 0.37 }, 10)).toBe(0.37);
  });

  it("estimates EPUB progress while text locations generate", () => {
    expect(epubReadingProgress({ index: 4, displayed: { page: 2, total: 3 } }, 10)).toBeCloseTo(
      0.45,
    );
    expect(epubReadingProgress({ index: 9, displayed: { page: 1, total: 1 } }, 10, true)).toBe(1);
  });
});
