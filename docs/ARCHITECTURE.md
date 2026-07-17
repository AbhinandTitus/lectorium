# Lectorium — Architecture

See ADRs in `docs/adr/` for the load-bearing decisions:
[0001 Tauri 2](adr/0001-tauri-2-shell.md) · [0002 EPUB engine](adr/0002-epub-engine.md) · [0003 PDF engine](adr/0003-pdf-engine.md) · [0004 Locator model](adr/0004-locator-model.md) · [0005 Security boundaries](adr/0005-security-boundaries.md)

## Process topology

```
┌──────────────────────────── Tauri (Rust) ────────────────────────────┐
│ commands/        typed IPC surface (thin; validation + delegation)   │
│ library/         roots, recursive scan, watcher (debounced),         │
│                  quick fingerprint → lazy BLAKE3, dedup, relink      │
│ metadata/        EPUB OPF / PDF info extraction, cover cache         │
│ db/              rusqlite + versioned migrations + rotating backups  │
│ protocol/        book:// scoped streaming (range requests for PDF)   │
│ logging/         local rotating file log, no network                 │
└──────────────────────────────────────────────────────────────────────┘
                    ↑ typed IPC (tauri-specta-style bindings)  ↑ book://
┌──────────────────────────── WebView (React/TS) ──────────────────────┐
│ app/             shell, routing between the four spaces, theme root  │
│ config/          identity.ts (name/tagline), tokens.css              │
│ spaces/room      static room (M1) → R3F room (M4), quality tiers     │
│ spaces/reader    ReaderEngine interface; engines/epub, engines/pdf,  │
│                  engines/text; locator.ts; selection toolbar;        │
│                  typography presets + calibration                    │
│ spaces/stacks    virtualized library browser, search, preview drawer │
│ spaces/commonplace  entries, tags, links, export, Recall             │
│ state/           Zustand slices (transient UI only)                  │
│ services/        repositories over IPC (books, annotations, vocab,   │
│                  settings) — the only modules that call invoke()     │
└──────────────────────────────────────────────────────────────────────┘
```

## Data ownership rules

- **SQLite (Rust side) is the single durable store.** Browser storage holds nothing durable; Zustand holds only transient UI state.
- Frontend accesses data exclusively through `services/*` repository modules → typed IPC commands → `db/` repositories in Rust. No ad-hoc SQL in components; no ad-hoc `invoke()` outside services.
- Schema is migrated with numbered, forward-only migrations; every migration is preceded by an automatic backup.

## The ReaderEngine seam

The product UI (pagination chrome, selection toolbar, annotations, TOC, search box) is engine-agnostic. Engines translate between native anchors and the locator envelope (ADR 0004). This is what allows epub.js → Readium replacement and PDF Original ↔ Reflow view switching without data migration.

## Rendering families vs. file formats

| source format | reading format(s) |
|---|---|
| EPUB | epub engine |
| PDF | pdf engine (Original) + text engine (Reflow, derived) |
| TXT / MD / HTML | text engine |
| MOBI/AZW3 | → cached EPUB via explicit Calibre adapter → epub engine |

`books.source_format` and `books.reading_format` are distinct columns for exactly this reason.

## Key flows

**Open book**: Room/Stacks → `open_book(id)` → Rust returns metadata + last locator → Reader mounts engine → engine resolves locator (primary → textQuote → coarse) → text visible; re-entry ribbon if gap since `last_opened_at`.

**Autosave**: engine emits locator on every navigation → debounced `save_location` (also flushed on blur, suspend, close via Tauri window events). Write is transactional upsert into `book_locations`.

**Scan**: user grants root → Rust walks it on a background thread → quick fingerprint triage (path+size+mtime) → new/changed files queued for metadata + cover extraction → events stream to Stacks with calm progress. Full BLAKE3 hashes fill in lazily; hash matches trigger move-relinking rather than duplicate rows.

**Keep to Commonplace**: selection → toolbar → entry created with book id, locator envelope, exact quote + prefix/suffix, optional note/heading → visible in Commonplace immediately; export renders Markdown/JSON with source locations.

## Performance budgets (measured in docs/PERFORMANCE.md)

- Warm launch → Room/resume shell < 2 s (typical Win 11 laptop)
- Resume opened EPUB → visible text < 1 s after shell
- Page turn (adjacent page prepared) < 100 ms response
- UI responsive while scanning 10,000 files
- PDF memory bounded (virtualization + LRU)
- 3D Room ≈ 0 GPU when static; never renders while Reader is open
