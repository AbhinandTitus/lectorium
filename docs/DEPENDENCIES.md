# Lectorium — Dependency Register

Policy: small coherent set; each entry lists role, license, and maintenance status at adoption time. Additions require an entry here.

## Runtime (frontend)

| Package | Role | License | Notes |
|---|---|---|---|
| react / react-dom | UI | MIT | |
| zustand | transient UI state only (no durable data) | MIT | tiny, no boilerplate |
| epubjs | EPUB rendering behind ReaderEngine (ADR 0002) | BSD-2 | swap seam to Readium preserved |
| pdfjs-dist | PDF rendering, text layer, search (ADR 0003) | Apache-2.0 | worker build |
| @tauri-apps/api + plugins (dialog, opener, persisted-scope…) | shell bridge | MIT/Apache-2.0 | plugins listed as added |

Deferred to their milestones: three / @react-three/fiber / drei (M4, MIT), Radix primitives (as needed, MIT).

## Runtime (Rust)

| Crate | Role | License |
|---|---|---|
| tauri 2 | shell | MIT/Apache-2.0 |
| rusqlite (bundled) | SQLite | MIT |
| blake3 | content hashing | CC0/Apache-2.0 |
| notify | file watching | CC0/Artistic-2.0 |
| walkdir | recursive scan | MIT/Unlicense |
| serde / serde_json | IPC + envelopes | MIT/Apache-2.0 |
| tracing + tracing-appender | local rotating logs | MIT |
| zip | EPUB container access for metadata | MIT |
| quick-xml | OPF/container parsing | MIT |
| uuid | ids | MIT/Apache-2.0 |
| thiserror | error types | MIT/Apache-2.0 |

## Dev

Vite, TypeScript (strict), ESLint, Prettier, Vitest, @testing-library/react, Playwright, @tauri-apps/cli.

## Bundled fonts (offline, licenses in `src/assets/fonts/LICENSES/`)

Literata (OFL), Source Serif 4 (OFL), EB Garamond (OFL), Atkinson Hyperlegible (OFL), Noto Sans (OFL), Noto Sans Malayalam (OFL), Noto Serif Malayalam (OFL), Inter (OFL, UI labels only).
