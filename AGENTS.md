# Working agreements for agents in this repository

Read `docs/PRODUCT.md` before changing product behavior. The anti-requirements there are hard constraints (no gamification, no telemetry, no network calls outside the opt-in dictionary adapter, no white flash in Ember, originals never modified).

## Invariants

- **Locators**: every stored position/annotation uses the envelope in [ADR 0004](docs/adr/0004-locator-model.md) (`primary` + `textQuote` + `coarse`). Never store a bare CFI, percentage, or page number.
- **Data**: SQLite via Rust is the only durable store. Frontend: repositories in `src/services/` are the only modules calling `invoke()`. Rust: SQL lives in `src-tauri/src/db/`, migrations are append-only, each preceded by an automatic backup.
- **Engines**: nothing outside `src/spaces/reader/engines/` imports epub.js or PDF.js types.
- **Themes**: colors come from `src/config/tokens.ts` (applied as CSS custom properties). The contrast test in `tokens.test.ts` must keep passing; never add pure #000/#FFF or blue focus rings.
- **Copy**: calm and exact. No "Oops!", no guilt, no stack traces in the UI, no counts of unread books on the home surface.
- **Security**: paths are scope-checked in Rust; publication content is sanitized; external links need explicit confirmation. See `docs/SECURITY.md`.
- **Malayalam** is first-class: any text-handling change must preserve Unicode shaping/segmentation (no slicing inside grapheme clusters).

## Checks before claiming a milestone

```
pnpm verify                # typecheck + lint + format + vitest
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

Update `docs/ROADMAP.md` checkboxes with evidence links; record measured performance in `docs/PERFORMANCE.md` (never claimed numbers). Report failures as failures.
