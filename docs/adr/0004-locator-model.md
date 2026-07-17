# ADR 0004 — Engine-agnostic locator model

Status: Accepted · Date: 2026-07-18

## Context

Exact resume, annotations, vocabulary, and Commonplace excerpts must survive: app restarts, typography/layout changes, engine replacement (epub.js → Readium), PDF Original↔Reflow switching, and file moves. A raw CFI string or page number alone is too brittle.

## Decision

Every stored location is a versioned JSON envelope with **redundant anchors**, ordered by resolution priority:

```jsonc
{
  "v": 1,
  "engine": "epub" | "pdf" | "text",          // rendering family, not library name
  "primary": { ... },                           // engine-native, most precise
  "textQuote": {                                // W3C-style fallback, engine-independent
    "exact": "…the words themselves…",
    "prefix": "up to 64 chars before",
    "suffix": "up to 64 chars after"
  },
  "coarse": { ... }                             // human/spatial context, last resort
}
```

Per family:

| family | primary | coarse |
|---|---|---|
| epub | EPUB CFI + spine index + section href | section title, spine index, % into section (hidden from UI) |
| pdf  | page index + page label + normalized page XY (+ rotation) | page index, section title from outline |
| text (TXT/MD/HTML/PDF-Reflow) | block index + char offset in canonical extracted stream | nearest heading, block index |

Resolution algorithm: try `primary`; verify against `textQuote` when text exists (quote mismatch ⇒ re-anchor by quote search near `coarse`); fall back to `coarse` with a quiet "approximate location" note only if both fail. Never silently jump to a rounded percentage.

PDF cross-view rule: the *stored* locator always carries the source-PDF `pageIndex` + `textQuote`, so Original↔Reflow switching resolves to the same passage in either view.

## Consequences

- Slightly larger rows (an envelope per annotation/location) — negligible against book sizes.
- Text-quote capture must be Unicode-safe (no slicing inside surrogate pairs or Malayalam grapheme clusters); use `Intl.Segmenter` grapheme boundaries when trimming context.
- A `locator.ts` module owns creation/resolution; engines only translate their native anchor into/out of the envelope.
