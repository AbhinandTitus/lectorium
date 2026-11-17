import { describe, expect, it } from "vitest";
import { themes } from "../../../config/tokens";
import { clampRect, imageRects, looksPhotographic, parseHexColor, recolorPixels } from "./pdfTheme";

const ember = {
  text: parseHexColor(themes.ember.textPrimary),
  page: parseHexColor(themes.ember.page),
};

function pixels(...colors: [number, number, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach(([r, g, b], i) => data.set([r, g, b, 255], i * 4));
  return data;
}

describe("recolorPixels", () => {
  it("maps paper to the page color and ink to the text color", () => {
    const data = pixels([255, 255, 255], [0, 0, 0]);
    recolorPixels(data, ember.text, ember.page);
    expect(Array.from(data.slice(0, 3))).toEqual(ember.page);
    expect(Array.from(data.slice(4, 7))).toEqual(ember.text);
  });

  it("never produces a bright page at night", () => {
    const data = pixels([255, 255, 255], [250, 248, 240], [230, 230, 230]);
    recolorPixels(data, ember.text, ember.page);
    for (let i = 0; i < data.length; i += 4) {
      expect(Math.max(data[i], data[i + 1], data[i + 2])).toBeLessThan(70);
    }
  });

  it("carries hue across so colored ink stays recognizable", () => {
    const data = pixels([200, 30, 30], [30, 60, 200]);
    recolorPixels(data, ember.text, ember.page);
    expect(data[0]).toBeGreaterThan(data[1] + 40); // red stays red
    expect(data[6]).toBeGreaterThan(data[4] + 40); // blue stays blue
  });

  it("is the identity for black ink on white paper", () => {
    const data = pixels([255, 255, 255], [0, 0, 0], [120, 120, 120]);
    recolorPixels(data, [0, 0, 0], [255, 255, 255]);
    expect(Array.from(data)).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 120, 120, 120, 255]);
  });
});

describe("looksPhotographic", () => {
  const fill = (width: number, height: number, at: (x: number, y: number) => number[]) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) data.set([...at(x, y), 255], (y * width + x) * 4);
    }
    return data;
  };
  const rect = { x: 0, y: 0, width: 96, height: 96 };

  it("treats a scanned text page as paper", () => {
    const scan = fill(96, 96, (x, y) =>
      y % 8 === 0 && x % 3 === 0 ? [20, 20, 20] : [244, 240, 232],
    );
    expect(looksPhotographic(scan, 96, rect)).toBe(false);
  });

  it("treats a colorful picture as a photograph", () => {
    const photo = fill(96, 96, (x, y) => [80 + x, 60 + y, 140]);
    expect(looksPhotographic(photo, 96, rect)).toBe(true);
  });
});

describe("imageRects", () => {
  const ops = {
    save: 1,
    restore: 2,
    transform: 3,
    paintFormXObjectBegin: 4,
    paintFormXObjectEnd: 5,
    paintImageXObject: 6,
    paintInlineImageXObject: 7,
    paintImageXObjectRepeat: 8,
  };
  // a 612x792 pt page at scale 1: PDF space is bottom-up, the canvas top-down
  const viewport = [1, 0, 0, -1, 0, 792];

  it("places an image using the transforms in force when it is painted", () => {
    const rects = imageRects(
      [ops.save, ops.transform, ops.paintImageXObject, ops.restore, ops.paintImageXObject],
      [null, [320, 0, 0, 240, 146, 180], ["img"], null, ["stray"]],
      ops,
      viewport,
      2,
    );
    expect(rects[0]).toEqual({ x: 292, y: (792 - 180 - 240) * 2, width: 640, height: 480 });
    // after restore the transform is gone: the second image is the unit square
    expect(rects[1].width).toBe(2);
  });

  it("follows form XObject matrices and ignores malformed arguments", () => {
    const rects = imageRects(
      [ops.paintFormXObjectBegin, ops.transform, ops.paintImageXObject, ops.paintFormXObjectEnd],
      [[[1, 0, 0, 1, 100, 100], null], "not a matrix", ["img"], null],
      ops,
      viewport,
      1,
    );
    expect(rects).toHaveLength(1);
    expect(rects[0].x).toBe(100);
    expect(imageRects([ops.paintImageXObject], [[]], ops, [1, 2], 1)).toEqual([]);
  });
});

describe("clampRect", () => {
  it("keeps rectangles on the canvas and drops slivers", () => {
    expect(clampRect({ x: -10.5, y: 5.2, width: 40, height: 20 }, 100, 100)).toEqual({
      x: 0,
      y: 5,
      width: 30,
      height: 21,
    });
    expect(clampRect({ x: 200, y: 0, width: 10, height: 10 }, 100, 100)).toBeNull();
    expect(clampRect({ x: 1, y: 1, width: 0.5, height: 30 }, 100, 100)).toBeNull();
  });
});
