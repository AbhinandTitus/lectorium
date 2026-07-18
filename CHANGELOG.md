# Changelog

All notable changes to Lectorium, grouped by milestone. This project is pre-1.0; versions are milestone tags rather than semantic releases. Dates are the build dates on the development machine.

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
