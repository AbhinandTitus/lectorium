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

## Milestone 1 — Library core and complete plain reader shell  ✓ COMPLETE (2026-07-18)

Known limitations carried to M2: EPUB textQuote anchors captured only by annotation flows (resume uses CFI+coarse today); PDF night mode is a mild luminance filter (Warm Dim/Smart Dark are M2); two-page Spread not yet offered; remaining reading fonts (Source Serif 4, EB Garamond, Atkinson) bundle with M2 calibration; file watcher replaced by startup rescan until M2.

- [x] Folder grant (dialog) + recursive background scan with fingerprint triage; startup rescan — [scanner.rs](../src-tauri/src/library/scanner.rs), 5 integration tests (add/rescan/EPUB meta/move-relink/missing)
- [x] SQLite persistence ([repo.rs](../src-tauri/src/db/repo.rs)); EPUB covers extracted; deterministic typographic fallback covers ([BookCover.tsx](../src/components/BookCover.tsx))
- [x] Stacks: search/filters/virtualized list/preview drawer/desk roles with 3-book conflict flow; "Find this file" relink — [Stacks.tsx](../src/spaces/stacks/Stacks.tsx)
- [x] EPUB/PDF/TXT/Markdown engines behind ReaderEngine seam, lazy-loaded — [engines/](../src/spaces/reader/engines/); bundled Malayalam fonts injected into EPUB iframes; Malayalam metadata verified Unicode-safe in Rust tests
- [x] Locator envelopes (ADR 0004) + debounced autosave, flush on blur/close — [Reader.tsx](../src/spaces/reader/Reader.tsx)
- [x] Ember/Paper themes; Focus/Open/Air presets; pagination; keyboard nav (arrows/space/F/A/Ctrl±/Esc-never-closes)
- [x] Static Room with desk books + Continue reading; onboarding (3 screens, all skippable)
- [x] **Acceptance verified live (2026-07-18, dev build on this machine):**
  - EPUB exact resume: opened fixture EPUB → paged to ch.3 (CFI `epubcfi(/6/6!/4/2/1:0)` autosaved) → closed app (window close) → relaunched → reopened → landed on Chapter Three, same CFI in `book_locations`.
  - PDF exact resume: opened 3-page fixture PDF via Stacks → next page (locator `{pageIndex:1,pageLabel:"2"}` autosaved) → closed app → relaunched → reopened → Reader chrome shows "Page 2".
  - Missing files lose no data: Rust integration tests (`scanner.rs::vanished_file_is_marked_missing_and_loses_nothing`, `moved_file_is_relinked_and_keeps_reading_position`).
  - Ember no-white-flash: window `backgroundColor #12100E` + pre-bundle inline Ember guard + Ember CSS fallbacks; observed dark across launch/open/read/close in desktop captures. (Automated frame-capture test lands with Playwright in M2.)
  - Real-library smoke: user's own folder scanned in the live app; real EPUB cover extracted and shown in Room; book placed on desk via the UI.

Fixed during live verification: book:// protocol needed CORS headers (page origin ≠ book.localhost — [protocol.rs](../src-tauri/src/protocol.rs)); fallback-cover percentage padding exploded against wide parents ([bookCover.css](../src/components/bookCover.css)); EPUB content links now warm+underlined, never blue; reflowable measure capped (~66ch) on wide windows.

Checks green (2026-07-18): `pnpm verify` (typecheck+lint+format+16 vitest), `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (10).

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
