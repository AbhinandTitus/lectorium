// Builds the deterministic, original-work fixtures described in
// docs/TESTING.md. Run explicitly with:  node fixtures/scripts/build-fixtures.mjs
// Never runs as part of install/build/test.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildZip } from "./zip.mjs";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- shared EPUB plumbing ----------

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function chapterXhtml(lang, title, bodyHtml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><title>${title}</title></head>
<body>
${bodyHtml}
</body>
</html>`;
}

function buildEpub({ id, lang, title, author, chapters }) {
  const manifestItems = chapters
    .map(
      (c, i) =>
        `    <item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join("\n");
  const spineItems = chapters.map((_, i) => `    <itemref idref="ch${i + 1}"/>`).join("\n");
  const navLis = chapters
    .map((c, i) => `      <li><a href="ch${i + 1}.xhtml">${c.title}</a></li>`)
    .join("\n");

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:${id}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>${lang}</dc:language>
    <meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
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

  const entries = [
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: CONTAINER_XML },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/nav.xhtml", data: nav },
    ...chapters.map((c, i) => ({
      name: `OEBPS/ch${i + 1}.xhtml`,
      data: chapterXhtml(c.lang ?? lang, c.title, c.body),
    })),
  ];
  return buildZip(entries);
}

// ---------- english novel fixture (original text) ----------

const englishChapters = [
  {
    title: "Chapter One — The Lamp",
    body: `<h1>Chapter One — The Lamp</h1>
<p>Miren kept a brass lamp on the corner of the desk, and by its amber circle the rest of the room agreed to disappear.</p>
<p>The book in front of her had waited nine years. It did not reproach her. Books, she had decided, keep no ledgers; they only keep their places.<sup><a epub:type="noteref" href="#fn1" id="fnref1">1</a></sup></p>
<p>She turned the first page the way one steps onto ice — testing whether it would hold. It held.</p>
<aside epub:type="footnote" id="fn1"><p>1. A place is not a page number. A place is a sentence you can stand on.</p></aside>`,
  },
  {
    title: "Chapter Two — The Shelf",
    body: `<h1>Chapter Two — The Shelf</h1>
<p>The shelf behind her held everything she had meant to become: histories, grammars, one intimidating volume on rhetoric with an uncracked spine.</p>
<blockquote><p>“We do not abandon books,” her grandfather had said. “We set them down where we can find them again.”</p></blockquote>
<p>She copied the sentence into her notebook under the heading <em>returning</em>, and dated it, and felt the small click of a thing kept.</p>`,
  },
  {
    title: "Chapter Three — The Window",
    body: `<h1>Chapter Three — The Window</h1>
<p>Past midnight the window gave back only lamplight and her own outline. She lowered the lamp, and the dark page grew kinder.</p>
<p>Somewhere in the house a clock disagreed with another clock. She read on: one page, then its neighbor, unhurried, the way water accepts a slow stone.</p>
<p>When she finally closed the book she marked the sentence she wanted to keep, so that tomorrow would begin exactly here.</p>`,
  },
];

// ---------- malayalam fixture (original text with conjuncts/chillus) ----------

const malayalamChapters = [
  {
    title: "അധ്യായം ഒന്ന് — വിളക്ക്",
    body: `<h1>അധ്യായം ഒന്ന് — വിളക്ക്</h1>
<p>മീരയുടെ മേശപ്പുറത്ത് ഒരു പിച്ചള വിളക്കുണ്ടായിരുന്നു. അതിന്റെ മഞ്ഞവെളിച്ചത്തിൽ മുറിയുടെ ബാക്കി ഭാഗം സ്വയം മറഞ്ഞു.</p>
<p>മുന്നിലിരുന്ന പുസ്തകം ഒൻപതു വർഷം കാത്തിരുന്നു. പുസ്തകങ്ങൾ കണക്കുപുസ്തകം സൂക്ഷിക്കുന്നില്ല; അവ സ്ഥലങ്ങൾ മാത്രം സൂക്ഷിക്കുന്നു.<sup><a epub:type="noteref" href="#fn1" id="fnref1">1</a></sup></p>
<p>ക്ലിപ്തമായ സന്ധ്യയിൽ, കാറ്റ് ജനാലയ്ക്കരികിൽ ശബ്ദമുണ്ടാക്കി. അവൾ ആദ്യപേജ് മറിച്ചു.</p>
<aside epub:type="footnote" id="fn1"><p>1. സ്ഥലം എന്നത് പേജ് നമ്പറല്ല; നിൽക്കാവുന്ന ഒരു വാക്യമാണ്.</p></aside>`,
  },
  {
    title: "അധ്യായം രണ്ട് — അലമാര",
    body: `<h1>അധ്യായം രണ്ട് — അലമാര</h1>
<p>പിന്നിലെ അലമാരയിൽ അവൾ ആകാൻ ആഗ്രഹിച്ചതെല്ലാം ഉണ്ടായിരുന്നു: ചരിത്രങ്ങൾ, വ്യാകരണങ്ങൾ, തുറക്കാത്ത ഒരു വലിയ ഗ്രന്ഥം.</p>
<blockquote><p>“നാം പുസ്തകങ്ങൾ ഉപേക്ഷിക്കുന്നില്ല; വീണ്ടും കണ്ടെത്താവുന്നിടത്ത് വെക്കുന്നു.” എന്ന് മുത്തച്ഛൻ പറഞ്ഞിരുന്നു.</p></blockquote>
<p>ആ വാക്യം അവൾ <em>മടങ്ങിവരവ്</em> എന്ന തലക്കെട്ടിനു കീഴിൽ പകർത്തി എഴുതി.</p>`,
  },
  {
    title: "Chapter Three — Mixed / കലർന്ന താളുകൾ",
    lang: "en",
    body: `<h1>Chapter Three — Mixed / കലർന്ന താളുകൾ</h1>
<p>Some evenings she read in two languages at once. The English sentence walked; <span xml:lang="ml" lang="ml">മലയാളം വാക്യം ഒഴുകി</span>; and the notebook accepted both without complaint.</p>
<p xml:lang="ml" lang="ml">വാക്കുകൾക്കിടയിൽ അതിരുകളില്ല എന്നു തോന്നിയ രാത്രികളിൽ, അവൾ രണ്ടു ഭാഷകളിലും ഒരേ ആശയം എഴുതി നോക്കി.</p>
<p>She kept one line for the morning: <span xml:lang="ml" lang="ml">നാളെ ഇവിടെ നിന്നു തുടങ്ങാം.</span></p>`,
  },
];

// ---------- misc fixtures ----------

const SAMPLE_TXT = `The Quiet Method

There is a way of reading that asks nothing of the clock.
You sit, you open to the kept place, and you go on.

It survives interruptions because the place is exact.
It survives years because the notebook remembers the why.

നാളെ ഇവിടെ നിന്നു തുടങ്ങാം — tomorrow, begin exactly here.
`;

const SAMPLE_MD = `# The Quiet Method

There is a way of reading that asks *nothing* of the clock.

## Keeping places

1. Open to the kept place.
2. Read one page, then its neighbor.
3. Mark **one** sentence worth keeping.

> We do not abandon books. We set them down where we can find them again.

- English line: begin exactly here.
- Malayalam line: നാളെ ഇവിടെ നിന്നു തുടങ്ങാം.

\`\`\`
code blocks must survive reflow untouched
\`\`\`
`;

// deterministic pseudo-random garbage that is definitely not a valid book
function malformedBytes() {
  const buf = Buffer.alloc(4096);
  let x = 0x9e3779b9;
  for (let i = 0; i < buf.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    buf[i] = x & 0xff;
  }
  buf.write("NOTABOOK", 0, "ascii");
  return buf;
}

// ---------- write everything ----------

function out(rel, data) {
  const p = join(fixturesDir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  console.log("wrote", rel, `(${data.length} bytes)`);
}

out(
  "epub/english-novel.epub",
  buildEpub({
    id: "6f1c2b7e-0001-4a01-b000-000000000001",
    lang: "en",
    title: "The Quiet Method",
    author: "Lectorium Fixtures",
    chapters: englishChapters,
  }),
);

out(
  "epub/malayalam.epub",
  buildEpub({
    id: "6f1c2b7e-0002-4a02-b000-000000000002",
    lang: "ml",
    title: "ശാന്തമായ രീതി",
    author: "ലെക്ടോറിയം ഫിക്സ്ചറുകൾ",
    chapters: malayalamChapters,
  }),
);

out("misc/sample.txt", SAMPLE_TXT);
out("misc/sample.md", SAMPLE_MD);
out("misc/malformed.bin", malformedBytes());

console.log("done");
