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
  /** one concise, context-appropriate sense — never a page of senses */
  sense: string;
  pronunciation: string | null;
  source: string;
}

export interface DictionaryAdapter {
  name: string;
  available(): Promise<boolean>;
  define(word: string): Promise<Definition | null>;
}

import { offlineDictionary } from "./offline";

const adapters: DictionaryAdapter[] = [offlineDictionary];

export interface DefineResult {
  definition: Definition | null;
  /** calm copy for the popover when nothing was found */
  message: string | null;
}

export async function define(rawWord: string): Promise<DefineResult> {
  const word = rawWord
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!word) return { definition: null, message: null };
  for (const adapter of adapters) {
    try {
      if (await adapter.available()) {
        const definition = await adapter.define(word);
        if (definition) return { definition, message: null };
      }
    } catch {
      // an adapter failure must never break reading
    }
  }
  return {
    definition: null,
    message: "No definition here yet. An offline dictionary can be added in Settings later.",
  };
}
