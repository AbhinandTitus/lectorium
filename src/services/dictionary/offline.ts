import type { Definition, DictionaryAdapter } from "./index";
import {
  dictionaryShard,
  morphologicalCandidates,
  selectContextualSense,
  type CompactSense,
} from "./lookup";

/**
 * Offline dictionary backed by build-time-generated WordNet shards under
 * /dict/. These are same-origin application assets, never remote requests.
 * Only the shard needed for the selected word is loaded and cached.
 */

interface DictionaryManifest {
  name: string;
  version: string;
  shards: Record<string, { entries: number; bytes: number }>;
}

type DictionaryShard = Record<string, CompactSense[]>;
let manifestPromise: Promise<DictionaryManifest | null> | null = null;
const shardPromises = new Map<string, Promise<DictionaryShard | null>>();

function loadManifest(): Promise<DictionaryManifest | null> {
  manifestPromise ??= window
    .fetch("/dict/manifest.json", { cache: "force-cache", credentials: "same-origin" })
    .then(async (response) =>
      response.ok ? ((await response.json()) as DictionaryManifest) : null,
    )
    .catch(() => null);
  return manifestPromise;
}

async function loadShard(name: string): Promise<DictionaryShard | null> {
  const manifest = await loadManifest();
  if (!manifest?.shards[name]) return null;
  let pending = shardPromises.get(name);
  if (!pending) {
    pending = window
      .fetch(`/dict/${name}.json`, { cache: "force-cache", credentials: "same-origin" })
      .then(async (response) => (response.ok ? ((await response.json()) as DictionaryShard) : null))
      .catch(() => null);
    shardPromises.set(name, pending);
  }
  return pending;
}

const PARTS: Record<CompactSense[0], Definition["partOfSpeech"]> = {
  n: "noun",
  v: "verb",
  a: "adjective",
  r: "adverb",
};

export const offlineDictionary: DictionaryAdapter = {
  name: "offline-en",
  async available() {
    return (await loadManifest()) !== null;
  },
  async define(word: string, context: string): Promise<Definition | null> {
    const manifest = await loadManifest();
    if (!manifest) return null;
    for (const candidate of morphologicalCandidates(word)) {
      const shard = await loadShard(dictionaryShard(candidate));
      const senses = shard?.[candidate];
      if (!senses?.length) continue;
      const sense = selectContextualSense(senses, context);
      return {
        word,
        headword: candidate,
        sense: sense[1],
        partOfSpeech: PARTS[sense[0]],
        pronunciation: null,
        source: `${manifest.name} ${manifest.version}`,
      };
    }
    return null;
  },
};
