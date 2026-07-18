# Lectorium — Project Handoff

> **Read this first if you are a new AI assistant or developer picking up this project.**
> It connects the *original intent* → the *product that exists today* → the *honest gaps* →
> a set of *questions I'd like your opinion on*. Everything here is written to be understood
> without access to the prior chat history.

---

## 0. How to use this document

- **§1–§2** tell you *why* this app exists and *what it is*. Do not propose changes that
  contradict these; they are the spine of the project.
- **§3** is the ground truth of *what is actually built* (verified against the code, not the plan).
- **§4** tells you how to *run, build, and verify* it on Windows.
- **§5** is the *map of the repository*.
- **§6** is the set of *hard-won lessons / gotchas* — the traps that already cost real debugging
  time. **Read this before touching the reader, the 3D room, or the packaged build.**
- **§7** is the *honest gap list*: what the original brief asked for that is partial or missing.
- **§8** is a set of **questions for you, the next AI** — where I actively want your opinion on
  improvements, *provided they stay true to §1–§2*.

The canonical source of the original vision is [`../Lectorium_Claude_Code_Build_Prompt (1).md`](../Lectorium_Claude_Code_Build_Prompt%20(1).md)
(the research-backed brief). This handoff summarizes and grounds it; that file is authoritative
if anything here disagrees with it.

---

## 1. The vision (do not drift from this)

**Lectorium — "a quiet room for books."** A calm, **local-first** Windows 11 desktop reader for a
large personal library of EPUBs, PDFs, and text formats.

The user it is built for: someone who **read deeply as a child, now starts books and rarely
returns**, is surrounded by high-frequency digital rewards, **dislikes fake gamification**, and
often reads **at night on a 27″ 2560×1440 monitor**. The product is **a reader that makes
beginning, returning, understanding, and remembering unusually frictionless** — *not* a tracker
with a reader bolted on.

### The five load-bearing principles

1. **One book is foreground; the library is background.** The opening screen never shows the whole
   library or an "unread mountain."
2. **Calm means low interaction density, not low capability.** Depth is fine; noise is not.
3. **No fake reward economy.** No streaks, XP, badges, coins, confetti, guilt copy, red overdue
   states, or nagging. Progress is a bookmark, a page, a shelf, a note — never points.
4. **Local-first and private.** No accounts, no telemetry, no analytics, no silent network calls,
   no cloud dependence. Book content and personal data stay on the machine.
5. **The 3D belongs at the doorway, not behind the text.** The Room is an atmospheric *entry*; the
   moment a book opens, the room fades and *releases the GPU*. Reading itself is flat, stable,
   typographic, and quiet.

### The four spaces (and only four)

| Space | Role |
|---|---|
| **Room** | Restrained 3D entry: the current book on a desk + at most two companions. One obvious action: *Continue reading*. |
| **Reader** | The primary surface. Full-screen, **paginated by default**, distraction-free. |
| **Stacks** | The fast **2D** searchable full library (not a 3D maze). |
| **Commonplace** | The reader's own quotes, notes, questions, vocabulary, and cross-book links. Includes opt-in **Recall** (retrieval before reveal, no scores). |

Settings is a **sheet**, not a fifth destination.

### Anti-requirements (things that must never be built)

Streaks/XP/badges/coins/leaderboards/confetti; guilt copy or overdue-red; social feed/profiles/
reviews/store; ads/telemetry/analytics/accounts/cloud; AI summaries shown *before* the user reads;
auto-generated highlights that replace the reader's thinking; infinite-scroll home; a 3D scene
animating *behind* text; pure-black-on-pure-white or bright-blue-at-night or bloom/flares/sudden
white loading screens; **automatic PDF→EPUB conversion or any modification of the original PDF**
(a reversible in-app *Reflow view* is the sanctioned alternative); DRM removal.

If a proposed feature trips any of these, it is out of scope no matter how good it sounds.

---

## 2. The reader who will actually use it

Young adult, Windows 11, very large local library (EPUB/PDF + occasional other formats). Reads
fiction, self-development, history, literature, and difficult nonfiction. Reads at night, lights
sometimes off, on an LG 2560×1440 27″ panel at **150% display scaling** (this detail matters —
see §6). Wants difficult books to feel **inviting, comprehensible, and memorable** — and finds
gamification insulting.

**Malayalam is a first-class language**, not a generic "non-Latin edge case": selection, copy,
notes, search, and Commonplace export must preserve Malayalam Unicode and shaping.

---

## 3. What actually exists today (ground truth)

Status: **all six milestones M0–M5 are complete, committed, and pushed** to a **private** GitHub
repo (`AbhinandTitus/lectorium`). Version `0.1.0`. An NSIS per-user installer builds
(`Lectorium_0.1.0_x64-setup.exe`).

### Stack (as actually used)

- **Tauri 2** shell (Rust core) + **WebView2** on Windows.
- **React 19 + TypeScript (strict) + Vite**, **pnpm 11**.
- **Rust 1.97 (MSVC)** for scanning, hashing, filesystem mediation, and the `book://` protocol.
- **SQLite** via `rusqlite` with **versioned migrations** + `VACUUM INTO` rotating backups.
- **epub.js** behind a `ReaderEngine` interface; **PDF.js**; a text engine for TXT/MD/HTML.
- **React Three Fiber + drei** for the Room, with a **static 2D fallback**.
- **Zustand** for transient UI state.
- **Vitest** for unit/component tests (27 passing across 4 files).

### Feature reality check (verified against the source)

| Area | State |
|---|---|
| Library scan (recursive, background), covers, dedup, missing-file relink | **Built** |
| Deterministic typographic covers for cover-less books (local, no network) | **Built** |
| Reader: pagination, exact-locator resume, re-entry ribbon, chrome auto-fade | **Built** |
| Locator model (CFI + textQuote + coarse envelope, engine-agnostic) | **Built** (ADR 0004) |
| Reading modes: **Story / Study / Contemplative** | **Built** (per-book) |
| Typography presets (Focus/Open/Air) + advanced controls + **Calibration** | **Built** |
| Themes: **Paper (day)** and **Ember (night)** | **Built** (Ember bug just fixed — §6.3) |
| PDF: fixed-layout render, text layer, search + **reversible Reflow view** | **Built** |
| Dictionary/selection lookup without leaving the reader | **Built** |
| Commonplace: Quote/Idea/Question/Vocabulary/Action/Character/Free note + tags | **Built** |
| Cross-book links (reader-created), Markdown + JSON export | **Built** |
| **Recall** (cue → "what do you remember?" → reveal; no grades/streaks) | **Built** |
| 3D Room: desk + current book + companions, demand-render, GPU released on read | **Built** (ADR 0001/M4) |
| Quiet Night (warm, low-luminance; honest about monitor-vs-paper) | **Built** |
| Security: strict CSP, sandboxed publications, scoped `book://`, no publication JS | **Built** (ADR 0005) |
| Backup/restore + import/export of user data | **Built** |
| NSIS installer + Start-pinnable launcher shortcut | **Built** |
| Malayalam language font stacks wired into the engines | **Built** (needs real-content QA — §7) |

See [`../CHANGELOG.md`](../CHANGELOG.md) and [`ROADMAP.md`](ROADMAP.md) for the milestone-by-
milestone record, and [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) for the verification gate.

---

## 4. Running, building, verifying (Windows)

> **Toolchain PATH gotcha:** `node`, `pnpm`, and `cargo` are not always on the default PATH in a
> fresh shell. Prepend them first (see [memory note](#) / §6.1). In PowerShell:
> ```powershell
> $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
>             [Environment]::GetEnvironmentVariable("Path","User") + ";$env:APPDATA\npm;$env:USERPROFILE\.cargo\bin"
> ```

| Task | Command |
|---|---|
| Install deps | `pnpm install` |
| Dev (hot reload) | `pnpm tauri dev` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Format | `pnpm format` |
| Unit tests | `pnpm test` |
| Full verify | `pnpm verify` (typecheck + lint + test) |
| Production build + installer | `pnpm tauri build` → `src-tauri/target/release/` (exe) and `.../bundle/nsis/` (installer) |

**Rust checks:** `cargo fmt`, `cargo clippy`, `cargo test` inside `src-tauri/`.

**The most important verification lesson:** *some bugs only exist in the packaged release build.*
Dev runs under a looser CSP and a size-locked WebView; the packaged build applies the strict CSP
and the real window size at 150% DPI. To inspect the real build, launch it with the DevTools port
open and drive it over the Chrome DevTools Protocol:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9223"
Start-Process "src-tauri\target\release\lectorium.exe"
# then GET http://127.0.0.1:9223/json  → page target url is  http://tauri.localhost/
```

The scratchpad in the working tree's temp dir has small CDP helper scripts (`cdp.mjs`, etc.) used
during debugging; they are not part of the repo but the pattern is worth keeping.

---

## 5. Repository map

```
src/
  app/            App shell, ErrorBoundary, Onboarding, Settings sheet
  config/         name/tagline (renameable), typography presets, quietNight, tokens
  services/       library, types, dictionary/  (typed repository/service layer)
  spaces/
    room/         3D Room (three/ meshes: DeskBook, shelves…) + 2D fallback
    reader/       Reader shell, Calibration, and engines/
      engines/    epubEngine.ts, pdfEngine.ts, pdfReflow.ts, textEngine.ts  (ReaderEngine impls)
    stacks/       2D searchable library
    commonplace/  entries, cross-links, export, Recall
  state/          Zustand stores (navigation, reader, …)
  test/           Vitest setup
src-tauri/
  src/
    protocol.rs   the scoped book:// asset protocol (Range streaming, CORS, scope checks)
    library/      recursive scan, hashing, metadata
    db/           migrations.rs (versioned) + repositories
    lib.rs        Tauri command surface
  tauri.conf.json CSP, bundle config, window config
docs/
  ADRs 0001–0005, ARCHITECTURE, PRODUCT, SECURITY, TESTING, PERFORMANCE,
  DEPENDENCIES, ROADMAP, RELEASE_CHECKLIST, and this HANDOFF
public/           reader-fonts.css + bundled fonts (loaded into chapter iframes)
fixtures/         sample books for manual testing
scripts/          create-shortcut.ps1 (Start-pinnable launcher)
```

Architecture Decision Records (read these before changing the corresponding subsystem):
- [ADR 0001 — Tauri 2 shell](adr/0001-tauri-2-shell.md)
- [ADR 0002 — epub.js behind a ReaderEngine interface](adr/0002-epub-engine.md)
- [ADR 0003 — PDF.js engine](adr/0003-pdf-engine.md)
- [ADR 0004 — engine-agnostic locator model](adr/0004-locator-model.md)
- [ADR 0005 — security boundaries](adr/0005-security-boundaries.md)

---

## 6. Hard-won lessons / gotchas (read before debugging)

These already cost real time. Respect them.

### 6.1 Windows toolchain PATH
A fresh shell may not have `node`/`pnpm`/`cargo` on PATH. Prepend Machine+User PATH plus
`%APPDATA%\npm` and `%USERPROFILE%\.cargo\bin` before running anything (see §4).

### 6.2 The 3D room can blank the whole app
drei's `useTexture` **throws** when a book-cover texture fails to load, and without an error
boundary around the R3F `<Canvas>` the throw unmounts the *entire* app to a white screen. Fixes in
place: covers now load imperatively via `THREE.TextureLoader` with a spine-color fallback and
**never throw** (`DeskBook.tsx`); an `ErrorBoundary` wraps both the space switch and the 3D room and
**falls back to the static room**; the `book://` protocol returns CORS headers even on errors; the
cover scope-check tolerates Windows packaged-path redirection. **Do not remove these safety nets.**

### 6.3 The CSP-in-iframe theme trap (the Ember "white page" bug)
**Symptom:** in the *packaged release only*, the Ember (night) theme rendered EPUB chapters as
black-on-white instead of light-on-dark. Paper (day) looked fine because white-on-white hides the
failure.

**Root cause (found by attaching DevTools to the real packaged build at 2560×1440 @ 150%):** the
chapter runs in a **same-origin iframe that inherits the app's strict CSP**, which has **no
`style-src 'unsafe-inline'`**. So *any* injected inline `<style>` — including epub.js's own
`themes.default()` — is present in the DOM but its stylesheet is **never applied** (`style.sheet`
is `null`). A transparent chapter document then renders **white by default**. This never
reproduced in dev because dev uses a looser CSP and a size-locked WebView.

**The fix (see `epubEngine.ts` → `injectThemeInto`):** theme via two **CSP-safe** channels —
1. **CSSOM writes** (`el.style.setProperty(...)`, `el.style.colorScheme = …`) are *exempt from CSP*
   (only markup-parsed inline styles are governed). These carry the load-bearing
   background/text-color/font and apply **synchronously** (no white flash).
2. an **external blob stylesheet** (`<link href="blob:…">`) — the same mechanism that already loads
   the bundled fonts — carries the cosmetic rules (link/selection colors, a wrapper-defeating
   `* { background: transparent }`).

**Rule for the future:** to style content inside the chapter iframe, use **CSSOM or an external
stylesheet — never an injected inline `<style>`.** If you ever consider adding
`style-src 'unsafe-inline'` to loosen this, weigh it against ADR 0005; the current fix keeps the
CSP strict.

### 6.4 Packaged-path redirection
`app_cache_dir` (and cover paths under it) can resolve to a **redirected path** in the packaged
build vs. dev. Scope checks must tolerate this (e.g. accept a path whose parent dir is `covers`)
rather than hard-failing "out of scope."

### 6.5 Wheel-to-flip pages
The EPUB chapter iframe swallows wheel events, so page-flip needs an explicit handler: the reader
stage handles `onWheel` for PDF/text, and the epub engine installs a wheel forwarder inside the
iframe (throttled ~380ms cooldown, sub-4px deltas ignored) that maps scroll intent to page turns.

### 6.6 Git & shell quoting on Windows
- Commits need identity flags each time: `git -c user.name="…" -c user.email="…" commit …`.
- PowerShell here-strings choke on apostrophes in commit bodies; write the message to a file and
  `git commit -F file`, or use a single-quoted `@'…'@` here-string with the closing `'@` at column 0.
- `git commit` writes to stderr, which PowerShell surfaces as a non-zero-looking result even when
  the commit succeeded — verify with `git log`, don't trust the exit banner alone.

---

## 7. Honest gaps & scope for improvement (aligned with the vision)

These are **within** the original brief but currently partial, deferred, or unverified. None of
them violate §1; they are the natural next work.

1. **MOBI / AZW3 import via Calibre** — the DB has a `derived_path` column and the library layer
   notes "needs explicit Calibre conversion," but the **actual Calibre `ebook-convert` adapter is
   not wired**. The brief specifies: detect the executable safely, DRM-free only, invoke with
   structured args (never a shell string), preserve the source, cache the derived EPUB rebuildably.
2. **Two-page Spread mode** — referenced in the epub engine but **not exposed** in Settings/Reader
   state. The brief allows an *optional* spread for wide windows, never auto-switching mid-book.
3. **Local OCR for scanned PDFs** — intentionally deferred. The architecture leaves an adapter
   point; visual reading of scanned PDFs works and text features should say "Text not available on
   this page." A local OCR adapter is the sanctioned enhancement (never a blocker for the reader).
4. **Malayalam real-content QA** — font stacks are wired through every engine, but there is no
   verified end-to-end pass on real Malayalam EPUB/PDF content (shaping, selection, copy, export,
   and the "broken/custom PDF encoding → report the limitation, don't corrupt" path).
5. **Browser-level / visual-regression tests** — the brief asked for Playwright flows + a Tauri
   smoke-test procedure. Only **Vitest** unit/component tests exist today. A packaged-build smoke
   test (the CSP/DPI class of bug in §6.3 would have been caught earlier by one) is the highest-
   value addition.
6. **Large-library performance at 10k+ files** — the scan is backgrounded and designed for it, but
   there is no captured benchmark on a genuinely large library. See [PERFORMANCE.md](PERFORMANCE.md).
7. **Reminder / one quiet cue** — the brief permits *one* optional, non-nagging cue at a chosen
   time with a one-action route back into the book. Confirm how much of this exists vs. is stubbed
   before extending it (it must never become a notification treadmill).

---

## 8. Questions for you, the next AI

I want your genuine opinion on these — **but only propose changes that stay true to §1–§2.** If an
idea would add a reward economy, a social layer, network dependence, or noise behind the text,
the answer is already no; don't suggest it.

1. **Reader fidelity vs. engine choice.** epub.js sits behind a `ReaderEngine` interface precisely
   so it can be swapped for a fuller Readium implementation later (ADR 0002). Given the CSP-in-
   iframe friction in §6.3 and the general limits of epub.js, **do you think a Readium-based engine
   is worth the migration now, or should epub.js be hardened further?** What would you look at first?
2. **The theme-injection design.** Is the CSSOM-plus-external-blob-stylesheet approach (§6.3) the
   right long-term answer, or is there a cleaner CSP-compatible way to theme sandboxed chapter
   content that you'd prefer? Are there failure modes I'm not seeing (e.g. publisher CSS specificity
   wars, `@media`/dark-mode CSS inside a publication)?
3. **Malayalam correctness.** What's the most efficient way to build real confidence here without a
   Malayalam-reading tester on hand — which specific shaping/normalization/encoding cases would you
   assert on, and how?
4. **Testing strategy.** If you could add exactly one test harness, would it be Playwright against
   dev, a **packaged-build** smoke test over CDP (which is where the real bugs live), or something
   else? What are the three highest-value assertions?
5. **Calm, honestly measured.** The whole product is a bet that *reducing cues and restart cost*
   helps someone return to books. **Without adding trackers or gamification, is there any ethical,
   private, non-nagging signal** that would tell us whether the design is actually working — or is
   the correct answer "measure nothing, trust the principles"? I genuinely want your view.
6. **Companion selection in the Room.** Today the two companions (one long-form, one short/easy) are
   chosen deterministically. Is there a *calm, local, non-recommendation-engine* way to make that
   choice feel more considered, without turning it into an algorithmic feed?
7. **What did I over-build?** Is there anything in here that adds interaction density without
   serving the reader — something a stricter reading of "calm means low interaction density, not low
   capability" would cut?

If you have a change in mind, please state (a) which principle in §1 it serves, (b) which
anti-requirement it risks brushing against and why it doesn't cross it, and (c) how you'd verify it
on the **packaged** Windows build, not just in dev.

---

*Last updated for the M5 release (v0.1.0), after fixing the Ember night-theme rendering bug. If you
change subsystem behavior, update the relevant ADR and the CHANGELOG alongside your code.*
