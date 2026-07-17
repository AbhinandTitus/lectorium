# Lectorium — Roadmap & Milestone Checklist

Evidence links (files/tests/results) are required before a box is checked. No vague percentages.

## Milestone 0 — Repository and product contract  ✓ COMPLETE (2026-07-18)

- [x] Environment inspected (Win 11, WebView2 150.0.4078.65 present; Node 24 LTS, pnpm 11, Rust 1.97.1 MSVC + VS Build Tools 2022 installed this session)
- [x] ADRs: [Tauri](adr/0001-tauri-2-shell.md), [EPUB](adr/0002-epub-engine.md), [PDF](adr/0003-pdf-engine.md), [Locators](adr/0004-locator-model.md), [Security](adr/0005-security-boundaries.md)
- [x] Docs: [PRODUCT](PRODUCT.md), [ARCHITECTURE](ARCHITECTURE.md), [SECURITY](SECURITY.md), [TESTING](TESTING.md), ROADMAP (this file)
- [x] Tauri 2 + React + TS + Vite scaffold builds and launches — verified `pnpm tauri dev` opens the window, applies migration v1, logs "database ready" (2026-07-18)
- [x] Identity config ([identity.ts](../src/config/identity.ts)) — name/tagline renameable in one file
- [x] Design tokens ([tokens.ts](../src/config/tokens.ts), Paper + Ember) + automated WCAG contrast test ([tokens.test.ts](../src/config/tokens.test.ts), 13 assertions incl. no-pure-black/white, low-luminance Ember, warm focus)
- [x] SQLite migrations v1 full schema ([migrations.rs](../src-tauri/src/db/migrations.rs)) + VACUUM INTO rotating backups ([mod.rs](../src-tauri/src/db/mod.rs)) with 3 passing Rust tests
- [x] Logging: local rotating daily file via tracing-appender ([logging.rs](../src-tauri/src/logging.rs)), no network
- [x] Checks green (2026-07-18): `pnpm verify` (typecheck + eslint + prettier + 16 vitest tests), `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (3 tests)

**Acceptance met:** dev app launches on WebView2; all checks green. CSP set in tauri.conf.json; eslint forbids network APIs outside the future dictionary adapter.

## Milestone 1 — Library core and complete plain reader shell

- [ ] Folder grant + persisted scope; recursive background scan; metadata queue
- [ ] SQLite persistence for books/locations; covers + deterministic typographic fallback covers
- [ ] Stacks: search/filter/status/desk roles; missing-file handling
- [ ] EPUB/PDF/TXT/Markdown open + render; Malayalam font fallback; Unicode-safe metadata/search
- [ ] Exact autosave/resume (restart-proof)
- [ ] Ember/Paper themes; Focus/Open/Air presets; pagination; keyboard nav
- [ ] Static Room (no 3D)

**Acceptance:** relaunch lands on exact page/CFI for EPUB and PDF; missing files lose no data; no white flash in Ember.

## Milestone 2 — Reader depth

- [ ] TOC/section map; fore-edge landmark; PDF Original/Reflow/night modes; cross-view locators
- [ ] Selection toolbar (Highlight/Note/Define/Keep/Copy); search; footnote popovers; dictionary adapter
- [ ] Story/Study/Contemplative modes; typography calibration
- [ ] Accessibility pass; Malayalam end-to-end; malicious-content hardening

**Acceptance:** the Reader is good enough to read a complete book before 3D work starts.

## Milestone 3 — Commonplace and recall

- [ ] Typed entries with source locators; tags/headings; explicit cross-links
- [ ] Markdown/JSON export; opt-in non-scored Recall; Study chapter-end prompt; practical-book Action

**Acceptance:** every exported excerpt navigates back to its source; Recall has no scores or forced prompts.

## Milestone 4 — 3D Room

- [ ] R3F room, demand rendering, instanced shelves, real cover + generated spine
- [ ] 500–700 ms open transition; unmount/pause in Reader and Quiet Night; quality tiers + static fallback

**Acceptance:** quality at 2560×1440; keyboard equivalents for every 3D action; measured GPU/CPU behavior.

## Milestone 5 — Hardening and Windows handoff

- [ ] 10k-library + large-PDF tests; crash recovery; backup/restore; installer; icon; first-run; `--resume` shortcut
- [ ] Manual QA at target resolutions/themes; clean-machine checklist; RELEASE_CHECKLIST.md with actual results
