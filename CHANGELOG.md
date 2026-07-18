# Changelog

All notable changes to Lectorium, grouped by milestone. This project is pre-1.0; versions are milestone tags rather than semantic releases. Dates are the build dates on the development machine.

## Fixes — 2026-07-19

- **Critical: the app could blank to a white/empty screen.** The 3D room loaded the current book's cover as a WebGL texture via a call that *throws* when the cover can't load, and with no error boundary around the R3F Canvas that unmounted the entire app. Now the cover loads imperatively and falls back to the spine color on any failure, a top-level error boundary shows a calm "back to the room" screen instead of a blank one, and the 3D room falls back to the static room if it ever errors. Also: the `book://` protocol now returns CORS headers on error responses (so a failed cover is a clean error, not an opaque CORS failure) and the cover scope-check tolerates Windows packaged-path redirection.
- **EPUB pagination on window resize.** epub.js paginates when a book opens but does not re-flow when the window resizes (maximize, snap, DPI change), which can leave columns mis-sized so content appears to scroll instead of flip. Added a resize observer that re-flows and re-anchors to the current location on any container size change.
- **Critical: the Ember (night) theme rendered EPUB chapters black-on-white in the packaged build.** Root cause, found by attaching DevTools to the real release build at 2560×1440 @ 150%: the chapter runs in a same-origin iframe that inherits the app's strict CSP, which has no `style-src 'unsafe-inline'`, so any injected inline `<style>` — including epub.js's own `themes.default()` — is present in the DOM but never applied (`style.sheet` is null), and a transparent chapter document then renders white. It never reproduced in dev (looser CSP, size-locked WebView). Paper hid the bug because its off-white matched the un-themed default. The theme is now applied through two CSP-safe channels: CSSOM writes (`el.style.setProperty`, `colorScheme`) which are exempt from CSP and carry the load-bearing background/text/font synchronously, plus an external blob stylesheet (the same mechanism that loads the bundled fonts) for the cosmetic rules. Verified on the packaged build: Ember `rgb(18,16,14)` background with warm light text, Paper its true warm off-white, and live Paper/Ember switching both correct.
- **Handoff documentation** added at `docs/HANDOFF.md`: a self-contained brief connecting the original vision, the current built state (verified against the code), the hard-won Windows/CSP/3D gotchas, an honest gap list, and open questions — written so another AI tool or developer can pick the project up cold.

## Fixes — 2026-07-18

- **Mouse-wheel page turning.** The Reader had keyboard and click-zone turns but no wheel handler, and for EPUB the chapter iframe swallowed wheel events entirely. Added throttled wheel-to-flip (one gesture = one page) across all three engines: EPUB forwards wheel from inside the iframe; PDF and text flip via the reader stage. Disabled in PDF Reflow, which genuinely scrolls. Verified live: EPUB CFI and text pagination both advance/retreat on wheel, the throttle collapses a rapid double-wheel to one turn, and tiny deltas are ignored.
- Added `scripts/create-shortcut.ps1` to generate a pinnable Desktop launcher for the built executable.

## Milestone 5 — Hardening and Windows handoff — 2026-07-18 (in progress)

- **Backup & restore:** on-demand atomic backup (VACUUM INTO + rotation); restore validates the file is a compatible Lectorium database, backs up current data first, then atomically replaces and re-migrates.
- **Import reading data:** reads a chosen exported `commonplace.json` entirely in Rust (the WebView never gets filesystem access), validates the version, matches entries to books by title/author, dedups by exact quote, and reports imported/skipped counts.
- **Settings sheet** (not a fifth destination): target bedtime → **Quiet Night** wind-down (warm/dark, decorative motion frozen, Recall deferred — never locks you out), one optional daily reminder time, a direct-resume toggle, and all the data actions.
- **Large-library benchmark:** a 10,000-file scan runs on a background thread with the UI responsive; the Stacks virtualized list stays smooth at 10k rows. Numbers and the batching optimization are recorded in `docs/PERFORMANCE.md`.
- **Installer** configured (NSIS, per-user install) and `docs/RELEASE_CHECKLIST.md` written with the automated-check results filled in and manual-QA/signing boxes left to complete on the release binary. Code signing is **not** configured and is not claimed.
- Rust tests added: backup roundtrip and reject-non-Lectorium-file; Quiet Night has 5 frontend unit tests.

## Milestone 4 — 3D Reading Room — 2026-07-18

- A restrained **3D Reading Room** behind the same actions: a walnut desk under an angled brass lamp with a shaded amber cone, the current book resting cover-up with its **real cover texture**, up to two companions, and shadowed shelves (a single InstancedMesh — never thousands of meshes).
- **Demand-driven rendering** (≈0 GPU when static), **paused** on window blur / reduced motion, and the scene **unmounts on Reader entry** to release the GPU. The open transition is a warm ~600 ms crossfade — never a bright frame.
- Quality tiers **High / Low / 2D**; **2D** and any WebGL failure fall back to the polished static room. Three.js is loaded lazily so it never slows launch. Every 3D interaction has a keyboard-accessible button equivalent.
- Verified live at 2560×1440 with the real cover; confirmed canvas unmount + Ember (no white flash) on open, and the 2D fallback.
- Dependencies: three, @react-three/fiber, @react-three/drei (MIT).

## Milestone 3 — Commonplace and Recall — 2026-07-18

- **Commonplace space** over the entries the reader already keeps: full-text search across their own quotes/notes/headings, facet filters by reader-defined heading and by kind, and a click back to the source book.
- **Cross-links** — explicit, bidirectional connections the reader creates between entries (deduped, never fabricated).
- **Export** to a chosen folder: Markdown grouped by heading and JSON carrying the full locator envelopes, so every excerpt can navigate back to its exact source. Never copies book files. Verified with Malayalam Unicode intact.
- **Vocabulary** capture: "Keep word" from the Define popover saves the word, its sentence, and locator.
- **Recall** — opt-in and non-scored: shows the reader's own cue/heading first, hides the passage until Reveal, and quietly schedules when an entry returns. No grades, percentages, streaks, or due-date shame.
- Rust: `list_commonplace`, `list_headings`, `link/unlink_entries`, `add/list_vocabulary`, `recall_available`, `record_recall`, `export_commonplace`.
- Verified live over CDP: entry listing with attribution, bidirectional linking, Markdown+JSON export with locators, Keep-word vocabulary, and the Recall flow (cue-first, no score).

## Milestone 2 — Reader depth — 2026-07-18

The Reader became good enough to read a complete English or Malayalam book, which is the acceptance gate before any 3D work.

- **Table of contents** for all three engines (EPUB nav, PDF outline with destination resolution, text headings) and a **fore-edge landmark** with chapter notches and a hidden-percentage position marker.
- **In-book search** across EPUB spine sections, PDF page text, and text blocks.
- **Selection toolbar** (Highlight / Note / Define / Keep / Copy), keyboard-accessible, with persistent annotations, highlight painting (epub.js layer + CSS Custom Highlight API), restoration after reopen, and bookmarks.
- **Footnotes** open in an in-app popover and return to source; external links are neutralized.
- **PDF Reflow** — a reversible *derived* view (never modifies the file): conservative layout analysis reconstructs headings/paragraphs with page anchors; Original ↔ Reflow preserves the source page; scanned or low-confidence PDFs refuse Reflow with calm copy.
- **Reading modes** (Story / Study / Contemplative) per book, with a Study chapter-boundary prompt that saves an Idea to the Commonplace.
- **Typography calibration** ("Make the page fit me"): five timed, matched, neutral passages across the bundled fonts; keeps comprehension-correct samples and picks the fastest; no score shown.
- **Security hardening (ADR 0005):** each chapter's parsed DOM is sanitized before epub.js writes the iframe — verified to produce zero scripts and zero network requests against a hostile fixture; six sanitizer unit tests.
- **Dictionary adapter seam** (offline stub + calm not-available copy; online seam reserved).
- Verified live over WebView2 CDP: TOC/search navigation, highlight persist-restore-repaint, Keep with heading, Study prompt, Malayalam font/search/conjunct highlight, malicious-EPUB isolation, PDF Reflow page preservation, 200% scaling with no horizontal scroll.

## Milestone 1 — Library core and complete plain reader shell — 2026-07-18

- **Rust scanner:** recursive background scan with fingerprint triage, EPUB OPF metadata + cover extraction, lazy BLAKE3 content hashing with move-relinking (annotations and progress survive a move), missing-file safety (data retained, never deleted), startup rescan of granted roots. Ten integration tests.
- **Scoped `book://` protocol** with HTTP Range streaming for large PDFs and path scope-checking against granted roots (ADR 0005).
- **Stacks:** search / filters / virtualized list / preview drawer / desk-role conflict flow; "Find this file" relink; deterministic typographic fallback covers generated locally.
- **Reader engines** for EPUB (epub.js), PDF (PDF.js), and text (TXT/Markdown/HTML) behind a single `ReaderEngine` interface, loaded lazily; engine-agnostic **locator envelopes** (ADR 0004).
- **Exact autosave/resume** (debounced, flushed on blur/close) — verified: EPUB CFI and PDF page both resumed after fully closing and relaunching the app.
- Static Room with desk books; three-screen skippable onboarding; Paper/Ember themes; Focus/Open/Air presets; keyboard navigation; direct-resume (`--resume` / standing preference).
- Bundled offline reading fonts (Literata, Noto Sans/Serif Malayalam, Noto Sans, etc.).

## Milestone 0 — Repository and product contract — 2026-07-18

- Toolchain installed (Node LTS, pnpm, Rust + MSVC Build Tools); Tauri 2 + React + TypeScript scaffold that launches on WebView2.
- Architecture Decision Records: Tauri shell, EPUB engine, PDF engine, locator model, security boundaries.
- Docs: product contract, architecture, security, testing, roadmap, dependency register, performance.
- Design tokens (Paper + Ember) as CSS custom properties with an automated WCAG-contrast test.
- SQLite schema with versioned, forward-only migrations and automatic rotating pre-migration backups.
- Local rotating file logging (no network); strict CSP; ESLint rule forbidding network APIs outside the sanctioned adapter directories.
