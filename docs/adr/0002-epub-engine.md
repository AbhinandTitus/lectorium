# ADR 0002 — EPUB engine: epub.js behind a ReaderEngine interface

Status: Accepted · Date: 2026-07-18

## Context

We need reflowable EPUB 2/3 rendering with pagination, CFI locators, TOC, reader-style overrides, and strict content sanitization. Longer term, a Readium-based stack (e.g. Thorium's readium-js / r2 components) may be a better foundation, and the product spec requires that swap to be possible without rewriting UI or data model.

## Decision

Use **epub.js** for MVP rendering, wrapped entirely behind a typed `ReaderEngine` interface that the product UI and data model depend on exclusively.

```
ReaderEngine
  open(source) / close()
  render(container, options)          // pagination, spread, styles
  display(locator) → Promise
  currentLocator(): Locator           // engine-agnostic (ADR 0004)
  next() / prev()
  toc(): TocEntry[]
  search(query): SearchResult[]
  selection events → { text, locator, context }
  applyTypography(settings) — must preserve logical locator
  annotations: add/remove/restore by locator
```

Nothing outside `src/reader/engines/` may import epub.js types. Locators are stored in the engine-agnostic JSON envelope from ADR 0004 (CFI + spine index + text-quote fallback), so a Readium engine can resolve the same records later.

## Sanitization stance

epub.js renders chapters into iframes. We do not trust its defaults:

- Publication scripts disabled (`allowScriptedContent: false` + sandbox flags without `allow-scripts`).
- Chapter HTML is additionally sanitized before injection (strip `<script>`, on* handlers, external URLs) in our loader hook.
- Remote resources blocked by CSP; per-book opt-in flips a scoped allowlist, never the global policy.

## Alternatives considered

- **readium-js / r2-navigator** — architecturally superior but heavier integration burden and less-documented local-file embedding under Tauri; chosen as the designated *future* engine, which is why the interface exists.
- **foliate-js** — clean, but younger and would still need the same wrapper; epub.js has broader CFI tooling.
- **Custom renderer** — months of work before a book opens. Rejected for MVP.

## Consequences

- Some epub.js quirks (pagination on very large chapters, CFI edge cases) must be papered over inside the engine wrapper, with a text-quote fallback re-anchoring pass.
- Engine swap = new folder in `src/reader/engines/` + feature flag; no schema migration.
