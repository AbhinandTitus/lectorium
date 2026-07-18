// Builds minimal, deterministic PDF fixtures by writing raw PDF syntax.
// Run explicitly: node fixtures/scripts/build-pdf-fixtures.mjs
//
// english-text.pdf — 3 pages of selectable Helvetica text (WinAnsi).
// scanned.pdf      — 1 page containing only a bitmap image (no text layer).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "pdf");
mkdirSync(outDir, { recursive: true });

/** Assemble a PDF from body objects (1-indexed), producing a valid xref. */
function buildPdf(objects) {
  let out = "%PDF-1.4\n";
  const offsets = [0];
  for (const body of objects) {
    offsets.push(Buffer.byteLength(out, "binary"));
    out += body;
  }
  const xrefStart = Buffer.byteLength(out, "binary");
  out += `xref\n0 ${objects.length + 1}\n`;
  out += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(out, "binary");
}

// ---------- english-text.pdf ----------

const pages = [
  [
    "The Quiet Method — Page One",
    "There is a way of reading that asks nothing of the clock.",
    "You sit, you open to the kept place, and you go on.",
  ],
  [
    "Page Two — Keeping Places",
    "A place is not a page number. A place is a sentence",
    "you can stand on, and return to tomorrow.",
  ],
  [
    "Page Three — The Return",
    "It survives interruptions because the place is exact.",
    "Begin exactly here.",
  ],
];

function pageContent(lines) {
  let text = "BT /F1 14 Tf 72 720 Td 20 TL\n";
  for (const line of lines) {
    text += `(${line.replace(/[()\\]/g, (c) => "\\" + c)}) Tj T*\n`;
  }
  text += "ET";
  return `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
}

{
  const objs = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>\nendobj\n",
  ];
  // page objects at 3,5,7; content streams at 4,6,8; font at 9
  pages.forEach((lines, i) => {
    const pageNum = 3 + i * 2;
    objs.push(
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 9 0 R >> >> /Contents ${pageNum + 1} 0 R >>\nendobj\n`,
    );
    objs.push(`${pageNum + 1} 0 obj\n${pageContent(lines)}\nendobj\n`);
  });
  objs.push(
    "9 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n",
  );
  writeFileSync(join(outDir, "english-text.pdf"), buildPdf(objs));
  console.log("wrote pdf/english-text.pdf");
}

// ---------- scanned.pdf (image-only page) ----------

{
  // 64x64 gray gradient, zlib-compressed grayscale bytes
  const size = 64;
  const raw = Buffer.alloc(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) raw[y * size + x] = 120 + ((x + y) % 100);
  const compressed = zlib.deflateSync(raw);

  const imgDict =
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${size} /Height ${size} ` +
    `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`;
  const imgObj = imgDict + compressed.toString("binary") + "\nendstream\nendobj\n";

  const content = "q 612 0 0 792 0 0 cm /Im1 Do Q";
  const objs = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    imgObj,
    `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
  ];
  writeFileSync(join(outDir, "scanned.pdf"), buildPdf(objs));
  console.log("wrote pdf/scanned.pdf");
}

console.log("done");
