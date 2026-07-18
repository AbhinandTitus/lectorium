// Generates a large synthetic library of tiny valid TXT/MD "books" for
// stress-testing scan + Stacks virtualization. Run explicitly:
//   node fixtures/scripts/make-large-library.mjs <dir> <count>
// Files are trivially small; this exercises scanning/indexing, not reading.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const count = Number(process.argv[3] ?? 10000);
if (!dir) {
  console.error("usage: node make-large-library.mjs <dir> <count>");
  process.exit(2);
}

const ADJ = ["Quiet", "Distant", "Amber", "Winter", "Hidden", "Slow", "Marginal", "Nocturnal"];
const NOUN = ["Harbor", "Library", "Cartographer", "Baker", "Method", "Shelf", "Lamp", "Window"];

let made = 0;
for (let i = 0; i < count; i++) {
  const sub = join(dir, `shelf-${Math.floor(i / 500)}`);
  mkdirSync(sub, { recursive: true });
  const title = `${ADJ[i % ADJ.length]} ${NOUN[(i >> 3) % NOUN.length]} ${i}`;
  const ext = i % 2 === 0 ? "txt" : "md";
  const body =
    ext === "md"
      ? `# ${title}\n\nA short synthetic book number ${i} for stress testing.\n`
      : `${title}\n\nA short synthetic book number ${i} for stress testing.\n`;
  writeFileSync(join(sub, `book-${i}.${ext}`), body);
  made++;
  if (made % 2000 === 0) console.log(`  ${made} / ${count}`);
}
console.log(`wrote ${made} files under ${dir}`);
