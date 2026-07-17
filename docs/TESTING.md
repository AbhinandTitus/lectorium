# Lectorium — Testing Strategy

## Layers

| Layer | Tool | Scope |
|---|---|---|
| Rust unit/integration | `cargo test` | scanner triage, hashing, dedup/relink, migrations, backup rotation, path scoping, metadata extraction |
| TS unit/component | Vitest + Testing Library | locator envelope create/resolve, reducers/stores, typography presets, reflow layout analysis, sanitizer, UI components |
| Browser flows | Playwright | reading flows, keyboard-only operation, theme (no-white-flash), visual regression at 2560×1440 / 1920×1080 (incl. 125% scaling assumptions), malicious-content network assertions |
| Tauri smoke | documented manual procedure + `scripts/smoke.md` | real window launch, folder grant, open/close/resume, installer sanity |

## Commands

```
pnpm check        # typecheck + eslint + prettier check
pnpm test         # vitest run
pnpm test:e2e     # playwright
cargo fmt --check && cargo clippy -- -D warnings && cargo test   # in src-tauri/
pnpm verify       # all of the above, CI entry point
```

## Fixtures (`fixtures/`)

All fixtures are original works created for this repo or public-domain, documented in `fixtures/README.md`. Scripts that download public-domain fixtures run only when explicitly invoked.

- `epub/english-novel.epub` — chapters, images, footnotes, TOC
- `epub/malayalam.epub` — headings, body, conjuncts/chillus, footnotes, TOC, mixed EN–ML text, searchable/selectable
- `epub/rtl.epub` — RTL content (Malayalam does not substitute for RTL testing)
- `epub/malicious-*.epub` — script, remote resource, dangerous URL, hostile CSS, traversal
- `pdf/english-text.pdf` — normal text PDF
- `pdf/malayalam-text.pdf` — embedded Malayalam font, correct Unicode mapping
- `pdf/malayalam-broken-encoding.pdf` — custom-encoded (extraction must be detected as unreliable)
- `pdf/scanned.pdf` — image-only pages
- `misc/malformed.bin`, `misc/sample.txt`, `misc/sample.md`

## Required scenario coverage

- import / rescan / dedup / move / relink
- exact resume across restarts and layout changes (EPUB CFI + PDF page/position)
- PDF Original ↔ Reflow without losing the passage; unreliable reflow refused/flagged
- EPUB CFI + text-quote annotation restoration; PDF page/coordinate restoration
- Malayalam: rendering/shaping, TOC, search, selection, copy, annotation restore, reflow where supported, Markdown/JSON export — zero Unicode corruption
- migration + backup recovery
- Ember never flashes white (Playwright screenshot frames during book open/close)
- keyboard-only: open book, navigate, select, annotate, appearance, exit
- 200% text scaling reflow without 2-D scrolling
- reduced motion + 2D room fallback
- 10k-file library virtualization responsiveness
- malicious EPUB isolation (see SECURITY.md checklist)

## Honesty rules

Failures are reported as failures. Performance numbers go in `docs/PERFORMANCE.md` with hardware context. No test is marked passing without having run.
