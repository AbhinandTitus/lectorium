# Lectorium — Dependency Register

Policy: small coherent set; each entry lists role, license, and maintenance status at adoption time. Additions require an entry here.

## Runtime (frontend)

| Package | Role | License | Notes |
|---|---|---|---|
| react / react-dom | UI | MIT | |
| zustand | transient UI state only (no durable data) | MIT | tiny, no boilerplate |
| epubjs 0.3 | EPUB rendering behind ReaderEngine (ADR 0002) | BSD-2 | loaded lazily on first book open; swap seam to Readium preserved; transitive `@xmldom/xmldom` is overridden to patched >=0.8.13 and core-js/es5-ext build scripts are declined in pnpm-workspace.yaml |
| pdfjs-dist 6 | PDF rendering (ADR 0003) | Apache-2.0 | worker build, lazy-loaded; no scripting factory supplied so PDF JS actions never run |
| marked | Markdown → HTML for the text engine | MIT | output passes our sanitizer before render |
| @tauri-apps/api + plugin-opener + plugin-dialog | shell bridge, external links, folder/file pickers | MIT/Apache-2.0 | |
| @fontsource/* (literata, noto-serif-malayalam, noto-sans-malayalam, noto-sans) + @fontsource-variable/inter | bundled offline fonts | OFL (fonts), MIT (packaging) | copied into `public/fonts` by `scripts/copy-fonts.mjs`; licenses copied alongside |

| three + @react-three/fiber | 3D Reading Room (M4) | MIT | loaded lazily; procedural geometry today with a seam for GLB/KTX2 assets |

Deferred: Radix primitives (as needed, MIT). Source Serif 4 / EB Garamond / Atkinson Hyperlegible fontsource packages were added in M2 for typography calibration.

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

Vite, TypeScript (strict), ESLint, Prettier, Vitest, @testing-library/react, @tauri-apps/cli. Playwright remains planned but is not installed/configured yet.

`wordnet-db` 3.1.14 supplies the Princeton WordNet 3.1 source files at build time. `scripts/build-dictionary.mjs` deterministically converts them into 27 first-letter JSON shards under `public/dict/`; no package code ships or executes at runtime. The npm package is MIT, the database uses the Princeton WordNet license, and that notice is bundled as `public/dict/LICENSE-WordNet.txt`.

## Bundled fonts (offline, licenses in `src/assets/fonts/LICENSES/`)

Literata (OFL), Source Serif 4 (OFL), EB Garamond (OFL), Atkinson Hyperlegible (OFL), Noto Sans (OFL), Noto Sans Malayalam (OFL), Noto Serif Malayalam (OFL), Inter (OFL, UI labels only).
