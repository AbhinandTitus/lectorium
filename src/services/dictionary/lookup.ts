import { sentenceAroundSelection } from "../../lib/selectionContext";

export type CompactPartOfSpeech = "n" | "v" | "a" | "r";
export type CompactSense = [partOfSpeech: CompactPartOfSpeech, definition: string, terms?: string];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "i",
  "in",
  "is",
  "it",
  "its",
  "not",
  "of",
  "on",
  "or",
  "she",
  "that",
  "the",
  "their",
  "they",
  "this",
  "to",
  "was",
  "were",
  "which",
  "with",
]);

const IRREGULAR_FORMS: Record<string, string[]> = {
  am: ["be"],
  are: ["be"],
  been: ["be"],
  better: ["good", "well"],
  best: ["good", "well"],
  bought: ["buy"],
  brought: ["bring"],
  children: ["child"],
  did: ["do"],
  done: ["do"],
  feet: ["foot"],
  geese: ["goose"],
  gone: ["go"],
  got: ["get"],
  gotten: ["get"],
  had: ["have"],
  has: ["have"],
  knew: ["know"],
  known: ["know"],
  made: ["make"],
  men: ["man"],
  mice: ["mouse"],
  ran: ["run"],
  saw: ["see"],
  seen: ["see"],
  teeth: ["tooth"],
  thought: ["think"],
  took: ["take"],
  taken: ["take"],
  was: ["be"],
  went: ["go"],
  were: ["be"],
  women: ["woman"],
  worse: ["bad", "badly"],
  worst: ["bad", "badly"],
  wrote: ["write"],
  written: ["write"],
};

export function normalizeDictionaryTerm(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[‘’]/gu, "'")
    .replace(/[‐‑‒–—]/gu, "-")
    .replace(/_/gu, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/\s+/gu, " ");
}

export function dictionaryTermFromSelection(selection: string): string {
  const text = selection.trim().replace(/\s+/gu, " ");
  const words = text.split(" ");
  return words.length <= 4 ? text : (words[0] ?? "");
}

export function dictionaryContext(prefix: string, exact: string, suffix: string): string {
  return sentenceAroundSelection(prefix, exact, suffix);
}

export function dictionaryShard(term: string): string {
  return /^[a-z]/u.test(term) ? term[0] : "other";
}

export function morphologicalCandidates(term: string): string[] {
  const candidates: string[] = [];
  const add = (candidate: string) => {
    if (candidate.length > 1 && !candidates.includes(candidate)) candidates.push(candidate);
  };
  add(term);
  for (const candidate of IRREGULAR_FORMS[term] ?? []) add(candidate);
  if (term.includes(" ")) return candidates;
  if (term.endsWith("'s")) add(term.slice(0, -2));
  if (term.endsWith("ies") && term.length > 4) add(`${term.slice(0, -3)}y`);
  if (term.endsWith("ves") && term.length > 4) {
    add(`${term.slice(0, -3)}f`);
    add(`${term.slice(0, -3)}fe`);
  }
  if (term.endsWith("es") && term.length > 4) {
    add(term.slice(0, -2));
    add(term.slice(0, -1));
  } else if (term.endsWith("s") && !term.endsWith("ss") && term.length > 3) {
    add(term.slice(0, -1));
  }
  if (term.endsWith("ied") && term.length > 4) add(`${term.slice(0, -3)}y`);
  if (term.endsWith("ed") && term.length > 4) {
    const stem = term.slice(0, -2);
    add(stem);
    add(`${stem}e`);
    if (/(.)\1$/u.test(stem)) add(stem.slice(0, -1));
  }
  if (term.endsWith("ing") && term.length > 5) {
    const stem = term.slice(0, -3);
    add(stem);
    add(`${stem}e`);
    if (/(.)\1$/u.test(stem)) add(stem.slice(0, -1));
  }
  if (term.endsWith("iest") && term.length > 5) add(`${term.slice(0, -4)}y`);
  if (term.endsWith("ier") && term.length > 4) add(`${term.slice(0, -3)}y`);
  if (term.endsWith("est") && term.length > 5) add(term.slice(0, -3));
  if (term.endsWith("er") && term.length > 4) add(term.slice(0, -2));
  return candidates;
}

function significantWords(value: string): Set<string> {
  const words = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[a-z][a-z'-]{1,}/gu);
  return new Set((words ?? []).filter((word) => !STOP_WORDS.has(word)));
}

export function selectContextualSense(senses: CompactSense[], context: string): CompactSense {
  const contextWords = significantWords(context);
  if (senses.length < 2 || contextWords.size === 0) return senses[0];
  let best = senses[0];
  let bestScore = 0;
  senses.forEach((sense, index) => {
    const definitionWords = significantWords(sense[1]);
    const synonymWords = significantWords(sense[2] ?? "");
    let score = -index * 0.05;
    for (const word of contextWords) {
      if (definitionWords.has(word)) score += 2;
      if (synonymWords.has(word)) score += 3;
    }
    if (score > bestScore) {
      best = sense;
      bestScore = score;
    }
  });
  return best;
}
