# Lectorium — Release Checklist

This is the sign-off gate for a Windows 11 release candidate. Every box must be checked with **actual observed results**, not assumptions. Nothing here claims code signing, performance, or compatibility that was not verified on real hardware.

## Build machine

- OS: Windows 11 Home 10.0.26200
- WebView2 runtime: present (150.x, ships with Windows 11)
- Toolchain: Node 24 LTS, pnpm 11, Rust 1.97.1 (MSVC), VS Build Tools 2022

## Automated checks (must all pass on the commit being released)

```
pnpm verify                                              # typecheck + eslint + prettier + vitest
cd src-tauri && cargo fmt --check
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo test
```

- [x] `pnpm verify` — 27 Vitest tests pass (incl. contrast, sanitizer, Quiet Night) — 2026-07-18
- [x] `cargo fmt --check` clean — 2026-07-18
- [x] `cargo clippy --all-targets -- -D warnings` clean — 2026-07-18
- [x] `cargo test` — 12 Rust tests pass (migrations, scan add/relink/missing, EPUB+Malayalam metadata, backup roundtrip + reject-bad-file, range parsing) — 2026-07-18

## Installer

```
pnpm tauri build          # produces target/release/bundle/nsis/Lectorium_<version>_x64-setup.exe
```

- [x] NSIS installer builds — `src-tauri/target/release/bundle/nsis/Lectorium_0.1.0_x64-setup.exe`, **4.58 MB**, per-user install mode (2026-07-18)
- [x] Release binary launches — `target/release/lectorium.exe` opens the "Lectorium" window on this machine (2026-07-18)
- [ ] Installer runs on a **clean** Windows 11 account (currentUser install mode, no admin required) — run on a fresh account/VM
- [ ] App launches from the Start Menu shortcut into the Room
- [ ] `--resume` argument (or a shortcut with it) launches straight into the most recent book
- [ ] **Code signing: NOT configured.** Do not claim signing. Ship unsigned, or configure a certificate and update this line only when it is truly in place.

## Manual QA — core flows (do these on the release build)

- [ ] Fresh onboarding: choose a nested library folder → shelves fill in the background → place one book on the desk
- [ ] Open EPUB, close app, relaunch → returns to the exact CFI
- [ ] Open PDF, page forward, close app, relaunch → returns to the exact page
- [ ] Move a book file within a root → rescan relinks it, notes/progress preserved
- [ ] Delete a book file → shows "Find this file", data retained; relink restores it
- [ ] Highlight / note / bookmark / Keep-to-Commonplace survive restart
- [ ] Commonplace: search, heading filter, cross-link, export (Markdown + JSON), import back
- [ ] Recall: cue-first, no scores, advances
- [ ] Back up now → restore → data returns; current data was backed up first
- [ ] PDF Reflow on a text PDF preserves the page; scanned PDF refuses Reflow with calm copy

## Manual QA — night & accessibility

- [ ] Ember theme: no white flash on launch, book open/close, PDF placeholder, or error surface
- [ ] Set a bedtime → within the wind-down hour, Quiet Night freezes decorative motion
- [ ] Reader operable with keyboard only (open, page, TOC, search, select tools, appearance, exit)
- [ ] 200% text scaling reflows with no horizontal scroll
- [ ] Reduced motion honored; WebGL-off / 2D room falls back to the static room

## Manual QA — resolutions & themes (visual)

- [ ] 2560×1440, Ember — Room, Reader, Stacks, Commonplace
- [ ] 2560×1440, Paper — same four
- [ ] 1920×1080 at 100% and 125% scaling — no clipped chrome, no 2-D scroll on reflowable text

## Malayalam

- [ ] Malayalam EPUB: rendering/shaping, TOC, search, selection, conjunct-spanning highlight, export — no Unicode corruption
- [ ] Malayalam PDF (if available): embedded-font visual render; search/copy report limitation gracefully if encoding is broken

## Security

- [ ] Malicious EPUB fixture renders inert: zero scripts in DOM, zero network requests (verified in dev via CDP; re-confirm on release build)
- [ ] No telemetry/analytics/update pings; CSP present with no remote origins
- [ ] Original book files never modified

## Sign-off

- Release commit: ____________________
- Signed off by: ____________________  Date: ____________
- Known limitations shipped with this build: see [ROADMAP.md](ROADMAP.md) "known limitations".
