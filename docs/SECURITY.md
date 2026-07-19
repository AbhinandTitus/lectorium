# Lectorium — Security Model

Authoritative decisions: [ADR 0005](adr/0005-security-boundaries.md). This document is the operational summary and checklist.

## Threat model

Assets: the user's filesystem, their private notes/library metadata, their attention (no dark patterns), and the integrity of original book files.

Adversaries: malicious or malformed publication files (EPUB HTML/CSS/SVG/scripts, PDF actions), path-traversal attempts through crafted archives, and any code path that could silently touch the network.

Out of scope: DRM circumvention (refused), OS-level compromise, physical access.

## Rules (enforced in code review and tests)

1. **Filesystem**: only user-granted roots + app cache are readable. Every Rust command canonicalizes and scope-checks paths. Archive entries are extracted with traversal guards. Original files are never modified or deleted.
2. **Content isolation**: publication scripts never execute; chapters render sandboxed and sanitized; remote resources blocked by default (per-book opt-in, disclosed); PDF scripting disabled.
3. **Network**: zero remote network calls exist in the product. The offline dictionary fetches only same-origin files bundled under `/dict/`; a future online adapter remains the sole sanctioned remote seam and must be explicitly enabled. No telemetry, analytics, update pings, or crash upload. CSP allows no remote origin.
4. **Links**: external URLs open only after explicit confirmation, in the system browser.
5. **Paths in UI**: rendered as text nodes only, never as HTML.
6. **Calibre adapter**: explicit user action, known-location executable, structured-argument process spawn (no shell string), DRM-free inputs only, source preserved.
7. **Data durability**: transactional writes, atomic replace, rotating pre-migration backups, versioned export/import with validation.

## Verification checklist (run each milestone)

- [ ] Malicious EPUB fixtures (script / remote resource / `javascript:` URL / hostile CSS / traversal zip) render inert with calm error copy.
- [ ] Playwright network assertion: no request leaves the app during library scan, book open, reading, export.
- [ ] Path scope tests: crafted `../` and absolute-path requests to `book://` are rejected.
- [ ] CSP present in built app config; no `unsafe-eval`.
- [ ] Grep gate in CI: no `fetch(`/`XMLHttpRequest`/`WebSocket` outside the dictionary adapter directory.
