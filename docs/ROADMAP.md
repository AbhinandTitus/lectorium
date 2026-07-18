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

## Milestone 2 — Reader depth  ✓ COMPLETE (2026-07-18)

- [x] TOC/section map (EPUB nav, PDF outline, text headings); fore-edge landmark with chapter notches + hidden-percentage position; PDF Original/Reflow + Ember night filter; cross-view PDF locators (page preserved across view switch) — verified live
- [x] Selection toolbar (Highlight/Note/Define/Keep/Copy), keyboard-accessible; in-book search (Ctrl+F) for all 3 engines; footnote popovers (noteref → in-app, returns to source, never navigates); dictionary adapter seam (offline stub + calm not-available copy) — verified live
- [x] Story/Study/Contemplative modes per book; Study chapter-boundary prompt saving an Idea; typography calibration ("Make the page fit me", 5 timed matched passages, fastest-correct font, no score shown) — verified live
- [x] Accessibility: 200% text scaling with no horizontal scroll (verified); annotation kind not color-only; Malayalam end-to-end (font stack, shaping, search, conjunct-spanning highlight with intact Unicode quote — verified live); malicious-content hardening (sanitizeDom: zero scripts, zero network attempts vs hostile fixture — verified live; 6 unit tests)

**Acceptance met:** a complete English or Malayalam EPUB, and text/scanned PDFs, are fully readable with annotations, search, TOC, modes, and reflow in the current build.

Known limitations to M5: online dictionary adapter not implemented (offline wordlist not yet bundled — Define shows calm copy); Contemplative mode uses the shared reader (no dedicated Read/Reflect/Respond/Rest layout yet); PDF Warm Dim / Smart Dark are a single Ember luminance filter, not the full three-way choice; two-page Spread not offered; RTL EPUB fixture not yet created; Playwright visual-regression + automated no-white-flash frame capture deferred to M5.

Live verification this milestone used WebView2 CDP (port 9223) + the devtool DB seeder — see [[lectorium-ui-verification]] memory. Checks green: `pnpm verify` (22 vitest incl. sanitizer), `cargo fmt/clippy/test` (10).

## Milestone 3 — Commonplace and recall  ✓ COMPLETE (2026-07-18)

- [x] Commonplace space over the entries the reader already keeps: search across own quotes/notes/headings, filter by reader-defined heading and by kind, jump back to source — [Commonplace.tsx](../src/spaces/commonplace/Commonplace.tsx). Verified live (4 captured entries incl. Malayalam, with correct attribution).
- [x] Explicit **cross-links** between entries (bidirectional, deduped) — verified live: linking two entries showed a connection chip on both.
- [x] **Export** to a chosen folder as Markdown (grouped by heading) + JSON (with full locator envelopes) — verified live: Malayalam Unicode intact, every JSON entry carries `startLocatorJson` so excerpts navigate back, links preserved.
- [x] **Vocabulary** capture: "Keep word" from the Define popover saves word + sentence + locator — verified live.
- [x] Opt-in **Recall** (non-scored): shows the reader's own cue/heading first, hides the passage until Reveal, no grades/percentages/streaks, spacing schedules availability quietly — verified live (cue-first, no score, advances). Study chapter-end prompt and practical-book Action delivered in M2.

**Acceptance met:** every exported excerpt carries its source locator (JSON) and attribution (Markdown); Recall has no scores or forced prompts.

Checks green: `pnpm verify` (22 vitest), `cargo fmt/clippy/test` (10). New Rust commands: list_commonplace, list_headings, link/unlink_entries, add/list_vocabulary, recall_available, record_recall, export_commonplace (writes Markdown + JSON, never copies book files).

## Milestone 4 — 3D Room  ✓ COMPLETE (2026-07-18)

- [x] R3F room (procedural geometry, a clean seam to swap in GLB/KTX2 later): walnut desk, angled brass lamp with a shaded amber cone, shadowed **instanced** shelf books (one InstancedMesh, never thousands of meshes), companion stand. Real cover texture on the current book; generated spine color otherwise — [three/](../src/spaces/room/three/). Verified live at 2560×1440 with the user's real "48 Laws of Power" cover.
- [x] **Demand rendering** (`frameloop="demand"`) → ~0 GPU when static; **pauses** (`frameloop="never"`) on window blur / hidden / reduced-motion. Scene **unmounts** on Reader entry (releases GPU) — verified: canvas gone, background stays Ember `#12100E` (no white flash).
- [x] ~600 ms open transition with a warm crossfade veil (never a bright frame). Quality tiers **High / Low / 2D** with a Room menu; **2D** and **WebGL-failure** both fall back to the static room — verified live (2D drops the canvas, static cover shows).
- [x] Three.js loaded **lazily** so it never weighs down launch; keyboard-accessible action buttons are the equivalent of every 3D interaction.

**Acceptance met:** renders at 2560×1440 with real cover; keyboard equivalents present; demand-rendered/paused/unmounted as specified. Measured GPU profiling deferred to M5 release hardening; demand rendering means a static scene issues no draw calls.

Checks green: `pnpm verify` (22 vitest), `cargo fmt/clippy/test` (10). Deps added: three, @react-three/fiber, @react-three/drei (all MIT).

## Milestone 5 — Hardening and Windows handoff  ⟵ IN PROGRESS

- [x] Backup/restore: on-demand `backup_now` (VACUUM INTO + rotation), `list_backups`, `restore_backup` (validates the file is a compatible Lectorium DB, backs up current data first, then atomically replaces and re-migrates). Import path: `import_reading_data` reads a chosen `commonplace.json` in Rust (no FS exposure to the WebView), validates version, matches books by title/author, dedups, and reports counts. Rust tests: backup roundtrip + reject-non-Lectorium-file.
- [x] Settings sheet (not a fifth destination): bedtime → **Quiet Night** wind-down, one daily reminder time, direct-resume toggle, and all data actions (export/import/backup/restore). Quiet Night unit-tested (5 cases incl. midnight wrap).
- [x] `--resume` launch + direct-resume preference open the most recent book (M1; surfaced in Settings here).
- [x] **10,000-file scan** benchmarked (76.8 s / ~130 files/s, debug build) on a background thread; UI stays responsive; Stacks virtualization stays smooth at 10k rows. Bottleneck (per-file autocommit) and the batching fix are recorded in [PERFORMANCE.md](PERFORMANCE.md).
- [x] Installer configured (NSIS, currentUser, publisher/description/icon) and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) written with the real automated-check results filled in.
- [ ] **Remaining for a true RC:** run the release-build installer on a clean account and complete the manual-QA/resolution/Malayalam/security boxes in RELEASE_CHECKLIST.md on that binary; profile launch/resume budgets on the release build; (optional) configure code signing — currently **not** configured and not claimed.
