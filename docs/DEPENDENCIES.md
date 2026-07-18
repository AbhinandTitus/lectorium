# Lectorium — Dependency Register

Policy: small coherent set; each entry lists role, license, and maintenance status at adoption time. Additions require an entry here.

## Runtime (frontend)

| Package | Role | License | Notes |
|---|---|---|---|
| react / react-dom | UI | MIT | |
| zustand | transient UI state only (no durable data) | MIT | tiny, no boilerplate |
| epubjs 0.3 | EPUB rendering behind ReaderEngine (ADR 0002) | BSD-2 | loaded lazily on first book open; swap seam to Readium preserved; its core-js/es5-ext transitive build scripts are declined in pnpm-workspace.yaml |
| pdfjs-dist 6 | PDF rendering (ADR 0003) | Apache-2.0 | worker build, lazy-loaded; no scripting factory supplied so PDF JS actions never run |
| marked | Markdown → HTML for the text engine | MIT | output passes our sanitizer before render |
| @tauri-apps/api + plugin-opener + plugin-dialog | shell bridge, external links, folder/file pickers | MIT/Apache-2.0 | |
| @fontsource/* (literata, noto-serif-malayalam, noto-sans-malayalam, noto-sans) + @fontsource-variable/inter | bundled offline fonts | OFL (fonts), MIT (packaging) | copied into `public/fonts` by `scripts/copy-fonts.mjs`; licenses copied alongside |

Deferred to their milestones: three / @react-three/fiber / drei (M4, MIT), Radix primitives (as needed, MIT), Source Serif 4 / EB Garamond / Atkinson Hyperlegible fontsource packages (M2 typography calibration).

## Runtime (Rust)

| Crate | Role | License |
|---|---|---|
| tauri 2 (+ plugin-opener, plugin-dialog) | shell | MIT/Apache-2.0 |
| rusqlite (bundled) | SQLite | MIT |
| blake3 | content hashing for identity/relink | CC0/Apache-2.0 |
| walkdir | recursive scan | MIT/Unlicense |
| serde / serde_json | IPC + envelopes | MIT/Apache-2.0 |
| tracing + tracing-subscriber + tracing-appender | local rotating logs | MIT |
| zip (deflate only, crypto features off) | EPUB container access for metadata | MIT |
| quick-xml | OPF/container parsing | MIT |
| uuid | ids | MIT/Apache-2.0 |
| thiserror | error types | MIT/Apache-2.0 |

Planned, not yet added: notify (file watcher — currently a startup rescan covers changed files).

## Dev

Vite, TypeScript (strict), ESLint, Prettier, Vitest, @testing-library/react, Playwright, @tauri-apps/cli.

## Bundled fonts (offline, licenses in `src/assets/fonts/LICENSES/`)

Literata (OFL), Source Serif 4 (OFL), EB Garamond (OFL), Atkinson Hyperlegible (OFL), Noto Sans (OFL), Noto Sans Malayalam (OFL), Noto Serif Malayalam (OFL), Inter (OFL, UI labels only).
