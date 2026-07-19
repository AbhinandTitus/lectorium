/**
 * Dictionary adapter seam (docs/PRODUCT.md — Selection toolbar / Define).
 *
 * Adapters are tried in order; the first definition wins. The offline
 * adapter reads a locally bundled wordlist when present. An online adapter
 * may only ever live in `./online/` (the sole sanctioned network seam),
 * must be explicitly enabled by the user, and is not implemented yet.
 */

export interface Definition {
  word: string;
  /** canonical dictionary lemma when an inflected form was selected */
  headword: string;
  /** one concise, context-appropriate sense — never a page of senses */
  sense: string;
  partOfSpeech: "noun" | "verb" | "adjective" | "adverb" | null;
  pronunciation: string | null;
  source: string;
}

export interface DictionaryAdapter {
  name: string;
  available(): Promise<boolean>;
  define(word: string, context: string): Promise<Definition | null>;
}

import { offlineDictionary } from "./offline";
import { normalizeDictionaryTerm } from "./lookup";

export { dictionaryContext, dictionaryTermFromSelection, normalizeDictionaryTerm } from "./lookup";

const adapters: DictionaryAdapter[] = [offlineDictionary];

export interface DefineResult {
  definition: Definition | null;
  /** calm copy for the popover when nothing was found */
  message: string | null;
}

export async function define(rawWord: string, context = ""): Promise<DefineResult> {
  const word = normalizeDictionaryTerm(rawWord);
  if (!word) return { definition: null, message: null };
  for (const adapter of adapters) {
    try {
      if (await adapter.available()) {
        const definition = await adapter.define(word, context);
        if (definition) return { definition, message: null };
      }
    } catch {
      // an adapter failure must never break reading
    }
  }
  return {
    definition: null,
    message: /\p{Script=Latin}/u.test(word)
      ? "No offline English definition was found."
      : "The bundled dictionary currently covers English words.",
  };
}
