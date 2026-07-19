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
- [x] Selection toolbar (Highlight/Note/Define/Keep/Copy), keyboard-accessible; in-book search (Ctrl+F) for all 3 engines; footnote popovers (noteref → in-app, returns to source, never navigates); dictionary adapter seam — verified live. The initial offline stub was replaced in M5 with bundled WordNet.
- [x] Story/Study/Contemplative modes per book; Study chapter-boundary prompt saving an Idea; typography calibration ("Make the page fit me", 5 timed matched passages, fastest-correct font, no score shown) — verified live
- [x] Accessibility: 200% text scaling with no horizontal scroll (verified); annotation kind not color-only; Malayalam end-to-end (font stack, shaping, search, conjunct-spanning highlight with intact Unicode quote — verified live); malicious-content hardening (sanitizeDom: zero scripts, zero network attempts vs hostile fixture — verified live; 6 unit tests)

**Acceptance met:** a complete English or Malayalam EPUB, and text/scanned PDFs, are fully readable with annotations, search, TOC, modes, and reflow in the current build.

Known limitations to M5: optional online dictionary adapter not implemented; Contemplative mode uses the shared reader (no dedicated Read/Reflect/Respond/Rest layout yet); PDF Warm Dim / Smart Dark are a single Ember luminance filter, not the full three-way choice; two-page Spread not offered; RTL EPUB fixture not yet created; Playwright visual-regression + automated no-white-flash frame capture deferred to M5.

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
- [x] Settings sheet (not a fifth destination): bedtime → **Quiet Night** wind-down, direct-resume toggle, and all data actions (export/import/backup/restore). Quiet Night now forces Ember in both the shell and book engine and is unit-tested (5 cases incl. midnight wrap). The non-functional reminder control was removed until real OS scheduling exists — [App.tsx](../src/app/App.tsx), [Reader.tsx](../src/spaces/reader/Reader.tsx), [Settings.tsx](../src/app/Settings.tsx).
- [x] `--resume` launch + direct-resume preference open the most recent book (M1; surfaced in Settings here).
- [x] **10,000-file scan** benchmarked (76.8 s / ~130 files/s, debug build) on a background thread; UI stays responsive; Stacks virtualization stays smooth at 10k rows. Bottleneck (per-file autocommit) and the batching fix are recorded in [PERFORMANCE.md](PERFORMANCE.md).
- [x] Installer configured (NSIS, currentUser, publisher/description/icon) and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) written with the real automated-check results filled in.
- [ ] **Remaining for a true RC:** run the release-build installer on a clean account and complete the manual-QA/resolution/Malayalam/security boxes in RELEASE_CHECKLIST.md on that binary; profile launch/resume budgets on the release build; (optional) configure code signing — currently **not** configured and not claimed.

### Corrective hardening pass — 2026-07-19

- [x] Native reader fullscreen uses the Tauri window API (with explicit capability), so Windows chrome and the taskbar are absent; `F`, `F11`, the reader control, and `Esc` provide keyboard-safe entry/exit. EPUB iframe keys/pointer activity are forwarded to the shell. Native dev smoke on the scaled test monitor: normal `206,41 1295×837` → fullscreen `0,0 1707×960` (full monitor versus `1707×912` taskbar work area), caption style absent; `Esc` restored the decorated normal window. EPUB/PDF/text share one restrained bottom progress meter showing only percentage; the live EPUB rendered `4%` with the 2 px theme-token track, while focused tests cover rounding/bounds/fallbacks. EPUB text-length locations generate in the background with a display-only fallback estimate. Tauri's dev/build hooks now use Corepack so a missing global `pnpm` cannot prevent native launch.
- [x] Rebuilt the optimized release at the existing `Lectorium.lnk` target after the shortcut was found to reference a stale morning build. Release smoke through that exact executable reported a live `5% read` meter and native fullscreen at `0,0 1707×960` with no caption or taskbar. Added the narrowly scoped Tauri window-destroy capability required by save-before-close; fullscreen exit and Reader close then exited cleanly.
- [x] Bundled Princeton WordNet 3.1 as a fully offline English dictionary: 147,478 entries in 27 on-demand shards (18.79 MiB total), with its license included. Define handles common inflections, chooses one concise sense using the selected sentence as context, and shows the canonical headword/part of speech. Vocabulary capture now preserves that full sentence and definition. Five focused tests cover local-only loading, morphology, sense choice, Unicode punctuation, and intact Malayalam context.

- [x] Commonplace/Recall/Vocabulary sources reopen the stored locator, and displayed attribution comes from each annotation envelope rather than the book's latest location — [navigation.ts](../src/state/navigation.ts), [repo.rs](../src-tauri/src/db/repo.rs), Rust round-trip test.
- [x] Export is no longer capped; JSON v2 preserves end locators, quote context, timestamps, links, and vocabulary book ownership. Import validates the entire file, writes in one transaction, supports legacy v1 safely, and is idempotent — `export_import_roundtrip_preserves_sources_links_and_vocabulary_ownership`, `malformed_import_is_rejected_before_any_write`.
- [x] Locator parsing validates engine-specific envelopes; EPUB falls back CFI → text quote → coarse spine; text locators retain block character offsets; quote/excerpt truncation uses grapheme segmentation for Malayalam — [locator.ts](../src/spaces/reader/locator.ts), [locator.test.ts](../src/spaces/reader/locator.test.ts).
- [x] EPUB Reader style preserves semantic callouts/blockquote classes on theme-safe raised surfaces; Paper offers an explicit Publisher style. HTML/Markdown now use a strict allowlist sanitizer. External HTTP(S) links remain inert until an in-app confirmation opens the system browser — [epubEngine.ts](../src/spaces/reader/engines/epubEngine.ts), [textEngine.ts](../src/spaces/reader/engines/textEngine.ts), sanitizer tests.
- [x] Scanner refreshes changed-file metadata, suppresses byte-identical live duplicates, uses component-aware root matching, and no longer mislabels MOBI/AZW3 as EPUB. Manual relink is canonicalized, root-scoped, format-checked, and hash-checked — [scanner.rs](../src-tauri/src/library/scanner.rs), 3 new regression tests.
- [x] Bookmarks/notes/highlights are navigable and removable from the Reader; vocabulary is browsable with source links; onboarding can choose the current desk book while scanning — [AnnotationsDrawer.tsx](../src/spaces/reader/AnnotationsDrawer.tsx), [Commonplace.tsx](../src/spaces/commonplace/Commonplace.tsx), [Onboarding.tsx](../src/app/Onboarding.tsx).
- [x] XML advisory chain is overridden to patched `@xmldom/xmldom >=0.8.13`; `pnpm audit --prod` reports no known vulnerabilities. Unused `@react-three/drei` was removed and the WebGL probe moved outside the lazy 3D chunk.
- [ ] Still requires packaged-app manual verification: representative EPUB callouts in Reader and Publisher styles, close-during-save, external-link confirmation, large-library scan, RTL, and all PDF behavior. The supplied `books/` corpus contains five EPUBs and no PDFs.

Checks green (2026-07-19): `corepack pnpm verify` (44 Vitest assertions across 8 files), production `corepack pnpm build`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (17), and `corepack pnpm audit --prod` (no known vulnerabilities).
