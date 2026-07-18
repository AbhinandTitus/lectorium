# Lectorium

*A quiet room for books.*

A Windows 11 desktop reader for a large local library of EPUBs, PDFs, and plain-text books — built as a **calm reading instrument, not a tracker**. One current book on the desk, exact resume, real typography, a personal commonplace book, and zero gamification. Everything stays on your computer; the app works fully offline.

Built with **Tauri 2 + React 19 + TypeScript** (frontend) and **Rust** (scanning, SQLite, scoped file access).

---

## Status at a glance

Milestones 0–2 are complete and verified; the Reader is already good enough to read a complete English or Malayalam book. Full evidence and known limitations live in [docs/ROADMAP.md](docs/ROADMAP.md).

| Milestone | State | Summary |
|---|---|---|
| **M0 — Foundation** | ✅ Complete | Toolchain, Tauri scaffold, ADRs + docs, design tokens (WCAG-tested), SQLite migrations + rotating backups, logging |
| **M1 — Library + reader shell** | ✅ Complete | Background scanner (hash dedup/relink, missing-file safety), Stacks, desk roles, EPUB/PDF/text engines, **exact resume across restarts** (verified), onboarding, Paper/Ember themes |
| **M2 — Reader depth** | ✅ Complete | TOC, search, selection toolbar, annotations + highlights, bookmarks, footnotes, fore-edge, **PDF Reflow** (reversible, page-preserving), Story/Study/Contemplative modes, typography calibration, **malicious-EPUB sanitizer** (verified inert), Malayalam end-to-end, 200% scaling |
| **M3 — Commonplace + Recall** | ⏳ In progress | Commonplace space UI, cross-links, Markdown/JSON export, opt-in non-scored Recall |
| **M4 — 3D Reading Room** | ⬜ Not started | R3F room with demand rendering, real cover, restrained transition, static fallback |
| **M5 — Hardening + release** | ⬜ Not started | Large-library/PDF tests, installer, clean-machine checklist, `RELEASE_CHECKLIST.md` |

All automated checks pass: `pnpm verify` (22 Vitest tests incl. the security sanitizer suite), `cargo fmt/clippy/test` (10 Rust tests). See [CHANGELOG.md](CHANGELOG.md) for the milestone history.

### What already works (verified live in the running app)

- Open EPUB / PDF / TXT / Markdown; close the app; **return to the exact page or CFI**.
- Table of contents, in-book search, highlights/notes/bookmarks that **survive restart and file moves**.
- Keep passages to a personal Commonplace with headings; Study-mode chapter prompts.
- PDF **Original ↔ Reflow** switching that preserves the page; scanned PDFs read visually and refuse Reflow with calm copy.
- **Malayalam** rendering, search, and conjunct-spanning highlights with intact Unicode.
- A hostile EPUB renders with **zero scripts and zero network requests**.
- Ember night theme never flashes a bright surface; 200 % text scaling reflows without horizontal scroll.

### What's left

- **Commonplace space** (browsing/editing entries, cross-links, Markdown/JSON export, opt-in Recall) — the capture side and data model already exist.
- **3D Reading Room** (currently a polished static room).
- **Release hardening**: installer, large-library stress tests, backup/restore drills, clean-machine checklist.
- Smaller documented gaps: online dictionary wordlist not yet bundled, dedicated Contemplative layout, PDF Warm-Dim/Smart-Dark split, RTL fixture, Playwright visual-regression. All tracked in [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Documentation

- [Product contract](docs/PRODUCT.md) — what this is and the anti-requirements (no gamification, no telemetry, no network)
- [Architecture](docs/ARCHITECTURE.md) and [Architecture Decision Records](docs/adr/)
- [Security model](docs/SECURITY.md) — local-first, untrusted-publication handling
- [Testing strategy](docs/TESTING.md)
- [Roadmap & milestone evidence](docs/ROADMAP.md)
- [Performance measurements](docs/PERFORMANCE.md)
- [Dependency register](docs/DEPENDENCIES.md)
- [Working agreements for contributors/agents](AGENTS.md)

## Development

Prerequisites: **Node.js LTS + pnpm**, **Rust (MSVC toolchain)**, and **WebView2** (ships with Windows 11).

```sh
pnpm install
# The bundled reading fonts in public/fonts are committed; regenerate them
# from the Fontsource packages only if you change the font set:
#   node scripts/copy-fonts.mjs
pnpm tauri dev                        # run the desktop app

pnpm verify                           # typecheck + lint + format check + unit tests
cd src-tauri
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

Legal test fixtures (original works + deterministic generators) are built with:

```sh
node fixtures/scripts/build-fixtures.mjs
node fixtures/scripts/build-pdf-fixtures.mjs
```

## Layout

```
src/           React + TypeScript frontend (the four spaces: Room, Reader, Stacks, Commonplace)
src-tauri/     Rust core: scanning, SQLite, migrations, scoped book:// protocol
docs/          product contract, ADRs, roadmap evidence
fixtures/      legal test fixtures (original or public-domain) + generators
scripts/       font bundling
```

## The four spaces

- **Room** — a restrained entry with your current book and up to two companions. One action: *Continue reading*. (3D scene arrives in M4; a static room ships today.)
- **Reader** — the product. Full-screen, paginated, distraction-free.
- **Stacks** — the fast, searchable full library.
- **Commonplace** — your quotes, notes, questions, and vocabulary with source locators. (Space UI arrives in M3; capture already works.)

## Principles (enforced, not aspirational)

No streaks, points, badges, or "unread mountain." No telemetry, analytics, or account. No silent network calls. Originals are never modified. See [docs/PRODUCT.md](docs/PRODUCT.md) for the full anti-requirements list.
