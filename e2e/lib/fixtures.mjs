// Deterministic stress fixtures for the browser harness, generated in memory
// (nothing binary is checked in). All text is original to this repository.

import zlib from "node:zlib";
import { buildZip } from "../../fixtures/scripts/zip.mjs";

// ---------- PNG ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** A banded RGB PNG; the bands make a sliced or squashed image obvious. */
export function makePng(width, height, [r, g, b]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    const band = Math.floor((y / height) * 8) % 2 === 0 ? 1 : 0.6;
    for (let x = 0; x < width; x++) {
      const edge = x < 6 || y < 6 || x >= width - 6 || y >= height - 6;
      const at = row + 1 + x * 3;
      raw[at] = edge ? 20 : Math.round(r * band);
      raw[at + 1] = edge ? 20 : Math.round(g * band);
      raw[at + 2] = edge ? 20 : Math.round(b * band);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- EPUB ----------

const SENTENCES = [
  "The lamp held its small circle and the rest of the room agreed to wait.",
  "She read the paragraph twice, not from doubt but because it deserved the second pass.",
  "Outside, the road kept its own slow account of the evening.",
  "A margin is a kind of patience, she thought, and wrote nothing in it yet.",
  "The argument turned on a single word, and the word did not hurry.",
  "He had underlined the same line years ago, in a pencil since worn to a stub.",
  "Nothing in the chapter insisted; it only continued, and that was enough.",
  "The kettle clicked off in another room and nobody went to it.",
];

/** Numbered paragraphs, so a test can name exactly which passage is visible. */
export function paragraph(chapter, n) {
  const body = [];
  for (let i = 0; i < 4; i++) body.push(SENTENCES[(chapter * 3 + n + i * 5) % SENTENCES.length]);
  return `Marker ${chapter}.${n}. ${body.join(" ")}`;
}

function paragraphs(chapter, from, to) {
  let html = "";
  for (let n = from; n <= to; n++) html += `<p>${paragraph(chapter, n)}</p>\n`;
  return html;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function xhtml(title, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xlink="http://www.w3.org/1999/xlink" xml:lang="en" lang="en">
<head><title>${title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>`;
}

/**
 * A long illustrated book: a Calibre-style SVG cover, a tall plate, a wide
 * plate, an image with hard pixel attributes, an inline image, and long
 * text chapters. Publisher CSS deliberately sets a white page and fixed
 * image sizes, as real-world files do.
 */
export function buildIllustratedEpub() {
  const chapters = [
    {
      title: "Cover",
      body: `<div class="cover"><svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="100%" height="100%" viewBox="0 0 800 1200" preserveAspectRatio="xMidYMid meet"><image width="800" height="1200" xlink:href="images/tall.png"/></svg></div>`,
    },
    {
      title: "One — Plates",
      body: `<h1>One — Plates</h1>
${paragraphs(1, 1, 6)}
<p class="plate"><img id="tall-plate" src="images/tall.png" alt="A tall plate"/></p>
${paragraphs(1, 7, 12)}
<figure><img id="wide-plate" src="images/wide.png" alt="A wide plate"/><figcaption>Figure 1. A wide plate with a caption.</figcaption></figure>
${paragraphs(1, 13, 18)}
<p><img id="fixed-plate" src="images/tall.png" width="900" height="1350" alt="Fixed-size plate"/></p>
${paragraphs(1, 19, 24)}
<p>An inline mark <img id="inline-mark" class="inline" src="images/small.png" alt="mark"/> sits inside this sentence and should stay on its line.</p>
<div class="styled-plate"><img id="styled-plate" src="images/wide.png" style="width: 1400px; height: 900px" alt="Styled plate"/></div>
${paragraphs(1, 25, 30)}`,
    },
    ...[2, 3, 4, 5, 6].map((c) => ({
      title: `${["", "", "Two", "Three", "Four", "Five", "Six"][c]} — The Long Chapter`,
      body: `<h1>${["", "", "Two", "Three", "Four", "Five", "Six"][c]} — The Long Chapter</h1>\n${paragraphs(c, 1, 70)}`,
    })),
  ];

  const manifest = chapters
    .map(
      (_, i) =>
        `    <item id="ch${i}" href="ch${i}.xhtml" media-type="application/xhtml+xml"${i === 0 ? ' properties="svg"' : ""}/>`,
    )
    .join("\n");
  const spine = chapters.map((_, i) => `    <itemref idref="ch${i}"/>`).join("\n");
  const navLis = chapters
    .map((c, i) => `      <li><a href="ch${i}.xhtml">${c.title}</a></li>`)
    .join("\n");

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:6f1c2b7e-0e2e-4a01-b000-0000000000e2</dc:identifier>
    <dc:title>The Illustrated Evening</dc:title>
    <dc:creator>Lectorium Fixtures</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="tall" href="images/tall.png" media-type="image/png"/>
    <item id="wide" href="images/wide.png" media-type="image/png"/>
    <item id="small" href="images/small.png" media-type="image/png"/>
${manifest}
  </manifest>
  <spine>
${spine}
  </spine>
</package>`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
${navLis}
    </ol>
  </nav>
</body>
</html>`;

  const css = `body { background: #ffffff; color: #000000; margin: 0 4%; }
p { margin: 0 0 0.9em; text-align: justify; }
.cover { text-align: center; height: 100%; }
.plate { text-align: center; }
figure { margin: 1em 0; text-align: center; }
figcaption { font-size: 0.85em; font-style: italic; }
img.inline { height: 1em; width: auto; vertical-align: baseline; }
`;

  return buildZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: CONTAINER_XML },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/nav.xhtml", data: nav },
    { name: "OEBPS/style.css", data: css },
    { name: "OEBPS/images/tall.png", data: makePng(800, 1200, [150, 90, 60]) },
    { name: "OEBPS/images/wide.png", data: makePng(1800, 520, [70, 110, 140]) },
    { name: "OEBPS/images/small.png", data: makePng(48, 48, [160, 140, 60]) },
    ...chapters.map((c, i) => ({ name: `OEBPS/ch${i}.xhtml`, data: xhtml(c.title, c.body) })),
  ]);
}

// ---------- PDF ----------

/**
 * A text PDF with `pageCount` pages; each page names itself in its text.
 * Folio 2 also carries a colorful raster image (a "photograph"), and the
 * document has a three-entry outline.
 */
export function buildLongPdf(pageCount = 90) {
  const objects = [];
  const kids = [];
  const fontObj = 3;
  const imageObj = 4;
  const outlineRoot = 5;
  const outlineStarts = [0, Math.floor(pageCount / 3), Math.floor((2 * pageCount) / 3)];
  const outlineItems = [6, 7, 8];
  objects[1] = `<< /Type /Catalog /Pages 2 0 R /Outlines ${outlineRoot} 0 R >>`;
  objects[fontObj] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;

  // 64x48 RGB image: saturated diagonal color bands
  const iw = 64;
  const ih = 48;
  const pixels = Buffer.alloc(iw * ih * 3);
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const band = Math.floor((x + y) / 12) % 3;
      const at = (y * iw + x) * 3;
      pixels[at] = band === 0 ? 200 : 40;
      pixels[at + 1] = band === 1 ? 170 : 50;
      pixels[at + 2] = band === 2 ? 210 : 60;
    }
  }
  const imageData = zlib.deflateSync(pixels);
  objects[imageObj] = Buffer.concat([
    Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${imageData.length} >>\nstream\n`,
      "binary",
    ),
    imageData,
    Buffer.from("\nendstream", "binary"),
  ]);

  let next = 9;
  const pageObjs = [];
  for (let p = 1; p <= pageCount; p++) {
    const pageObj = next++;
    const contentObj = next++;
    pageObjs.push(pageObj);
    kids.push(`${pageObj} 0 R`);
    let text = `BT /F1 14 Tf 72 720 Td 20 TL\n(Folio ${p} of the long proof) Tj T*\n`;
    const lines = p === 2 ? 8 : 24;
    for (let line = 1; line <= lines; line++) {
      text += `(Line ${line} on folio ${p}: ${SENTENCES[(p + line) % SENTENCES.length].replace(/[()\\]/g, "")}) Tj T*\n`;
    }
    text += "ET";
    if (p === 2) text += `\nq 320 0 0 240 146 180 cm /Im1 Do Q`;
    const xobjects = p === 2 ? ` /XObject << /Im1 ${imageObj} 0 R >>` : "";
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObj} 0 R /Resources << /Font << /F1 ${fontObj} 0 R >>${xobjects} >> >>`;
    objects[contentObj] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  }
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>`;
  objects[outlineRoot] =
    `<< /Type /Outlines /First ${outlineItems[0]} 0 R /Last ${outlineItems[2]} 0 R /Count 3 >>`;
  ["Part One", "Part Two", "Part Three"].forEach((title, i) => {
    const prev = i > 0 ? ` /Prev ${outlineItems[i - 1]} 0 R` : "";
    const nextRef = i < 2 ? ` /Next ${outlineItems[i + 1]} 0 R` : "";
    objects[outlineItems[i]] =
      `<< /Title (${title}) /Parent ${outlineRoot} 0 R${prev}${nextRef} /Dest [${pageObjs[outlineStarts[i]]} 0 R /Fit] >>`;
  });

  const parts = [Buffer.from("%PDF-1.4\n", "binary")];
  let length = parts[0].length;
  const offsets = [0];
  for (let i = 1; i < next; i++) {
    offsets[i] = length;
    const body = Buffer.isBuffer(objects[i]) ? objects[i] : Buffer.from(objects[i], "binary");
    const chunk = Buffer.concat([
      Buffer.from(`${i} 0 obj\n`, "binary"),
      body,
      Buffer.from("\nendobj\n", "binary"),
    ]);
    parts.push(chunk);
    length += chunk.length;
  }
  let tail = `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let i = 1; i < next; i++) tail += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  tail += `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(tail, "binary"));
  return Buffer.concat(parts);
}

// ---------- long single-block HTML (text engine) ----------

/** One wrapper element holding the whole book — common in saved web pages. */
export function buildWrappedHtml() {
  let html = `<html><head><title>Wrapped</title></head><body><div class="content"><h1>Wrapped Notes</h1>`;
  for (let n = 1; n <= 160; n++) html += `<p>${paragraph(9, n)}</p>`;
  return `${html}</div></body></html>`;
}
