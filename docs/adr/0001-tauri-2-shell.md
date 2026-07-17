# ADR 0001 — Tauri 2 as the desktop shell

Status: Accepted · Date: 2026-07-18

## Context

Lectorium is a Windows 11–first desktop reader for a large local library. It needs: native filesystem access with explicit scoping, a fast background scanner/hasher, a modern web rendering surface for typography-heavy reading (including complex Malayalam shaping), small binaries, and zero cloud dependence.

## Decision

Use **Tauri 2** with a React + TypeScript + Vite frontend and a Rust core.

- The WebView2 runtime (Chromium) provides first-class text shaping (HarfBuzz-equivalent), CSS typography (`hyphens`, `font-size-adjust`, variable fonts), and mature JS ecosystems for EPUB (epub.js) and PDF (PDF.js).
- Rust owns everything that is IO-heavy or trust-sensitive: recursive scanning, file watching, BLAKE3 hashing, SQLite persistence, cover extraction/caching, and mediated file serving to the WebView.
- Tauri's capability/permission system + strict CSP gives us an enforceable security boundary around untrusted publication content (see ADR 0005).

## Alternatives considered

- **Electron** — heavier binaries and memory; weaker default security posture; no Rust-side scoping primitives. Rejected.
- **Native (WinUI/WPF)** — best OS integration, but no mature EPUB/PDF rendering stack of PDF.js/epub.js quality; complex-script text layout for book content would be a research project. Rejected.
- **Flutter** — text shaping is good, but EPUB/PDF ecosystems are immature and the DOM-text requirement (real selectable text, screen readers) favors a web surface. Rejected.

## Consequences

- All heavy IPC payloads (book bytes) must go through a custom scoped protocol, not JSON IPC (ADR 0005).
- WebView2 is a hard dependency; it ships with Windows 11 (verified present on the target machine).
- Rust toolchain (MSVC) is required to build.
