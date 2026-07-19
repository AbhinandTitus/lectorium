/**
 * Returns the sentence surrounding an exact selection. The fragments may be
 * an entire chapter or just a short locator quote; no fixed-width slicing is
 * performed here, so engines can preserve a complete sentence for Vocabulary.
 */
export function sentenceAroundSelection(prefix: string, exact: string, suffix: string): string {
  const sentenceBoundary = /[.!?…।](?:["'’”)\]]*)\s*|[\r\n]+\s*/gu;
  let prefixStart = 0;
  for (const match of prefix.matchAll(sentenceBoundary)) {
    prefixStart = (match.index ?? 0) + match[0].length;
  }
  const suffixBoundary = suffix.match(/[.!?…।](?:["'’”)\]]*)|[\r\n]+/u);
  const suffixEnd = suffixBoundary?.index ?? -1;
  const suffixLength = suffixBoundary?.[0].length ?? 0;
  return `${prefix.slice(prefixStart)}${exact}${suffixEnd >= 0 ? suffix.slice(0, suffixEnd + suffixLength) : suffix}`
    .trim()
    .replace(/\s+/gu, " ");
}
