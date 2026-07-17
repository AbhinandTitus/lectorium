# Lectorium

*A quiet room for books.*

A Windows 11 desktop reader for a large local library of EPUBs, PDFs, and plain-text books — built as a calm reading instrument, not a tracker. One current book on the desk, exact resume, real typography, a personal commonplace book, and zero gamification. Everything stays on this computer.

## Documentation

- [Product contract](docs/PRODUCT.md) — what this is and the anti-requirements
- [Architecture](docs/ARCHITECTURE.md) and [ADRs](docs/adr/)
- [Security model](docs/SECURITY.md)
- [Testing strategy](docs/TESTING.md)
- [Roadmap & milestone evidence](docs/ROADMAP.md)
- [Dependency register](docs/DEPENDENCIES.md)

## Development

Prerequisites: Node.js LTS + pnpm, Rust (MSVC toolchain), WebView2 (ships with Windows 11).

```sh
pnpm install
pnpm tauri dev      # run the desktop app
pnpm verify         # typecheck + lint + format check + unit tests
cd src-tauri
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

## Layout

```
src/           React + TypeScript frontend (the four spaces)
src-tauri/     Rust core: scanning, SQLite, migrations, scoped file access
docs/          product contract, ADRs, roadmap evidence
fixtures/      legal test fixtures (original or public-domain)
```
