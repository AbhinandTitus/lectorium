import type { Definition, DictionaryAdapter } from "./index";

/**
 * Offline dictionary backed by an optional locally bundled wordlist at
 * /dict/en.json (word -> { sense, pron }). The file ships when a
 * responsibly licensed WordNet-compatible package is added (see
 * docs/DEPENDENCIES.md); until then this adapter reports unavailable and
 * Define shows calm copy instead of pretending.
 */

type WordEntry = { sense: string; pron?: string };
let cache: Record<string, WordEntry> | null | undefined;

async function load(): Promise<Record<string, WordEntry> | null> {
  if (cache !== undefined) return cache;
  try {
    const res = await window.fetch("/dict/en.json");
    cache = res.ok ? ((await res.json()) as Record<string, WordEntry>) : null;
  } catch {
    cache = null;
  }
  return cache;
}

export const offlineDictionary: DictionaryAdapter = {
  name: "offline-en",
  async available() {
    return (await load()) !== null;
  },
  async define(word: string): Promise<Definition | null> {
    const dict = await load();
    const entry = dict?.[word];
    if (!entry) return null;
    return {
      word,
      sense: entry.sense,
      pronunciation: entry.pron ?? null,
      source: "Offline dictionary",
    };
  },
};
