/**
 * Theming for PDF pages (ADR 0003). A PDF is painted by PDF.js exactly as
 * the file describes it — usually black on white — into an off-screen
 * buffer. Before it reaches the screen the pixels are mapped onto the
 * reading theme: paper-white becomes the page color, ink becomes the text
 * color, and hue is carried across so colored headings, links and charts
 * stay recognizable. Photographs are put back untouched, because a
 * photograph mapped by luminance turns into a negative.
 *
 * The file is never modified; this is a view (docs/PRODUCT.md).
 */

export type Rgb = [number, number, number];

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function parseHexColor(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** How much of a pixel's hue survives the mapping. */
const CHROMA_KEEP = 0.72;

/**
 * Map every pixel from "ink on white paper" to "foreground on background".
 * `data` is RGBA, modified in place.
 */
export function recolorPixels(data: Uint8ClampedArray, foreground: Rgb, background: Rgb): void {
  const [fr, fg, fb] = foreground;
  const [br, bg, bb] = background;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const l = gray / 255;
    const inv = 1 - l;
    data[i] = br * l + fr * inv + (r - gray) * CHROMA_KEEP;
    data[i + 1] = bg * l + fg * inv + (g - gray) * CHROMA_KEEP;
    data[i + 2] = bb * l + fb * inv + (b - gray) * CHROMA_KEEP;
  }
}

/**
 * Is this region a photograph (keep it) rather than a scan of text or a
 * line drawing on white (theme it like the rest of the page)? Paper-like
 * regions are mostly bright and nearly colorless.
 */
export function looksPhotographic(
  data: Uint8ClampedArray,
  canvasWidth: number,
  rect: PixelRect,
): boolean {
  const stepX = Math.max(1, Math.floor(rect.width / 48));
  const stepY = Math.max(1, Math.floor(rect.height / 48));
  let samples = 0;
  let paperLike = 0;
  for (let y = rect.y; y < rect.y + rect.height; y += stepY) {
    for (let x = rect.x; x < rect.x + rect.width; x += stepX) {
      const i = (y * canvasWidth + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      samples += 1;
      // bright and unsaturated, or pure ink: what a scanned text page is made of
      if ((min > 170 && max - min < 40) || max < 60) paperLike += 1;
    }
  }
  return samples === 0 ? false : paperLike / samples < 0.72;
}

/** Clamp a rectangle to the canvas and to whole pixels. */
export function clampRect(rect: PixelRect, width: number, height: number): PixelRect | null {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.height));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

type Matrix = [number, number, number, number, number, number];

function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function isMatrix(value: unknown): value is Matrix {
  return (
    (Array.isArray(value) || ArrayBuffer.isView(value)) &&
    (value as ArrayLike<unknown>).length === 6 &&
    Array.from(value as ArrayLike<unknown>).every(
      (n) => typeof n === "number" && Number.isFinite(n),
    )
  );
}

export interface OperatorCodes {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageXObjectRepeat: number;
}

/**
 * Walk a PDF.js operator list and return the bounding box of every raster
 * image, in canvas pixels. Images are drawn into the unit square under the
 * current transform, so tracking save/restore/transform is enough.
 */
export function imageRects(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  ops: OperatorCodes,
  viewportTransform: number[],
  pixelRatio: number,
): PixelRect[] {
  const rects: PixelRect[] = [];
  if (!isMatrix(viewportTransform)) return rects;
  let ctm: Matrix = [...viewportTransform] as Matrix;
  const stack: Matrix[] = [];
  const unitBox = (m: Matrix): PixelRect => {
    const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
    const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
      x: x * pixelRatio,
      y: y * pixelRatio,
      width: (Math.max(...xs) - x) * pixelRatio,
      height: (Math.max(...ys) - y) * pixelRatio,
    };
  };
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null;
    if (fn === ops.save) {
      stack.push(ctm);
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === ops.transform) {
      if (isMatrix(args)) ctm = multiply(ctm, args);
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix = args?.[0];
      if (isMatrix(matrix)) ctm = multiply(ctm, matrix);
    } else if (fn === ops.paintFormXObjectEnd) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject) {
      rects.push(unitBox(ctm));
    } else if (fn === ops.paintImageXObjectRepeat) {
      const scaleX = args?.[1];
      const scaleY = args?.[2];
      const positions = args?.[3];
      if (
        typeof scaleX === "number" &&
        typeof scaleY === "number" &&
        (Array.isArray(positions) || ArrayBuffer.isView(positions))
      ) {
        const list = positions as ArrayLike<number>;
        for (let p = 0; p + 1 < list.length; p += 2) {
          rects.push(unitBox(multiply(ctm, [scaleX, 0, 0, scaleY, list[p], list[p + 1]])));
        }
      }
    }
  }
  return rects;
}
