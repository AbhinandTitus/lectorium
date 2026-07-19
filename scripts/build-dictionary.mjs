import { createRequire } from "node:module";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const wordnet = require("wordnet-db");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "public", "dict");
const partFiles = [
  ["noun", "n"],
  ["verb", "v"],
  ["adj", "a"],
  ["adv", "r"],
];

function cleanLemma(value) {
  return value
    .replaceAll("_", " ")
    .replace(/\([ap]\)$/u, "")
    .trim()
    .toLowerCase();
}

function parseSynsets(text, partOfSpeech) {
  const synsets = new Map();
  for (const line of text.split(/\r?\n/u)) {
    if (!/^\d{8}\s/u.test(line)) continue;
    const separator = line.indexOf(" | ");
    if (separator === -1) continue;
    const fields = line.slice(0, separator).trim().split(/\s+/u);
    const wordCount = Number.parseInt(fields[3] ?? "0", 16);
    if (!Number.isFinite(wordCount) || wordCount < 1) continue;
    const synonyms = [];
    for (let index = 0; index < wordCount; index += 1) {
      const word = fields[4 + index * 2];
      if (word) synonyms.push(cleanLemma(word));
    }
    let definition = line
      .slice(separator + 3)
      .trim()
      .replace(/\s+/gu, " ");
    const example = definition.search(/;\s*"/u);
    if (example >= 0) definition = definition.slice(0, example).trim();
    if (!definition) continue;
    synsets.set(fields[0], { partOfSpeech, definition, synonyms });
  }
  return synsets;
}

function shardName(term) {
  const first = term[0];
  return first && /[a-z]/u.test(first) ? first : "other";
}

await mkdir(outputDirectory, { recursive: true });
for (const name of await readdir(outputDirectory)) {
  if (name.endsWith(".json") || name === "LICENSE-WordNet.txt") {
    await unlink(path.join(outputDirectory, name));
  }
}

const synsetsByPart = new Map();
for (const [filePart, partOfSpeech] of partFiles) {
  const data = await readFile(path.join(wordnet.path, `data.${filePart}`), "ascii");
  synsetsByPart.set(partOfSpeech, parseSynsets(data, partOfSpeech));
}

const digitToPart = new Map([
  ["1", "n"],
  ["2", "v"],
  ["3", "a"],
  ["4", "r"],
  ["5", "a"],
]);
const entries = new Map();
const senseIndex = await readFile(path.join(wordnet.path, "index.sense"), "ascii");
for (const line of senseIndex.split(/\r?\n/u)) {
  const fields = line.trim().split(/\s+/u);
  if (fields.length !== 4) continue;
  const marker = fields[0].indexOf("%");
  if (marker < 1) continue;
  const lemma = cleanLemma(fields[0].slice(0, marker));
  const partOfSpeech = digitToPart.get(fields[0][marker + 1]);
  if (!partOfSpeech) continue;
  const synset = synsetsByPart.get(partOfSpeech)?.get(fields[1]);
  if (!synset) continue;
  const synonyms = synset.synonyms.filter((word) => word !== lemma).join(" ");
  const senses = entries.get(lemma) ?? [];
  if (senses.some((sense) => sense.offset === fields[1] && sense.partOfSpeech === partOfSpeech)) {
    continue;
  }
  senses.push({
    offset: fields[1],
    partOfSpeech,
    definition: synset.definition,
    synonyms,
    senseNumber: Number.parseInt(fields[2], 10) || 999,
    taggedCount: Number.parseInt(fields[3], 10) || 0,
  });
  entries.set(lemma, senses);
}

const shards = new Map();
for (const [lemma, senses] of entries) {
  senses.sort(
    (left, right) => right.taggedCount - left.taggedCount || left.senseNumber - right.senseNumber,
  );
  const compact = senses.slice(0, 4).map((sense) => {
    const value = [sense.partOfSpeech, sense.definition];
    if (sense.synonyms) value.push(sense.synonyms);
    return value;
  });
  const name = shardName(lemma);
  const shard = shards.get(name) ?? new Map();
  shard.set(lemma, compact);
  shards.set(name, shard);
}

const shardDetails = {};
for (const name of [...shards.keys()].sort()) {
  const sorted = [...shards.get(name).entries()].sort(([left], [right]) =>
    left.localeCompare(right, "en"),
  );
  const json = JSON.stringify(Object.fromEntries(sorted));
  await writeFile(path.join(outputDirectory, `${name}.json`), json);
  shardDetails[name] = { entries: sorted.length, bytes: Buffer.byteLength(json) };
}

for (const required of ["book", "read", "quiet", "supercilious"]) {
  if (!entries.has(required))
    throw new Error(`WordNet build is missing required entry: ${required}`);
}

const manifest = {
  format: 1,
  name: "Princeton WordNet",
  version: wordnet.version,
  entries: entries.size,
  shards: shardDetails,
  license: "LICENSE-WordNet.txt",
};
await writeFile(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
const license = await readFile(path.join(path.dirname(wordnet.path), "LICENSE"), "utf8");
await writeFile(
  path.join(outputDirectory, "LICENSE-WordNet.txt"),
  license.replace(/[ \t]+$/gmu, "").replace(/\r\n/gu, "\n"),
);

const totalBytes = Object.values(shardDetails).reduce((sum, shard) => sum + shard.bytes, 0);
console.log(
  `Built WordNet ${wordnet.version}: ${entries.size.toLocaleString("en")} entries, ${(
    totalBytes /
    1024 /
    1024
  ).toFixed(1)} MiB across ${Object.keys(shardDetails).length} shards.`,
);
