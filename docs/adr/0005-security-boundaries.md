# ADR 0005 — Security boundaries for untrusted publications

Status: Accepted · Date: 2026-07-18

## Context

Every book file is untrusted input: EPUB HTML/CSS/SVG can carry scripts, remote beacons, and dangerous URLs; PDFs can carry JS actions and malformed structures. The app is local-first with zero silent network calls, and filesystem access must be limited to what the user granted.

## Decision

### Filesystem scoping
- The user explicitly selects library roots. Grants persist via Tauri's persisted-scope mechanism.
- Rust commands validate every path: canonicalize, then require it to be inside a granted root or the app-owned cache dir. No broad home-directory grant, ever.
- Book bytes reach the WebView only through a custom `book://` protocol handler in Rust that (a) resolves an opaque book id → canonical path via the DB, (b) rejects traversal, (c) serves ranges for large PDFs. File paths themselves are never interpolated into HTML.

### WebView hardening
- Strict CSP in `tauri.conf.json`: `default-src 'self'; connect-src 'self' ipc: http://ipc.localhost; img-src 'self' book: data: blob:; media-src book: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'` — no remote origins. (`style-src 'unsafe-inline'` is required by reader style injection; publication CSS is sanitized before injection.)
- Publication JavaScript: disabled. EPUB chapters render in sandboxed iframes without `allow-scripts`; chapter DOM is sanitized (scripts, event handlers, `javascript:` URLs, external references stripped) before display.
- PDF.js: `enableScripting: false`, `isEvalSupported: false`; JS actions and embedded-file attachments ignored.
- Remote images/fonts in publications: blocked by default; per-book opt-in adds specific origins to that book's session only, with visible disclosure.
- External links (EPUB anchors, PDF link annotations): never navigate the WebView. Explicit confirmation dialog → system browser via the opener plugin.

### Data safety
- SQLite writes are transactional; automatic rotating backups before migrations and periodically after meaningful changes; atomic file replacement (write-temp + rename).
- Export/import formats are versioned JSON + Markdown; import validates schema and previews conflicts.
- Optional Calibre `ebook-convert`: explicit user action only, DRM-free files only, executable detected at known install paths (never PATH-searched shell strings), invoked with structured args via `Command` — no shell. Source file preserved; output goes to app cache with provenance.

### Non-negotiables
- No telemetry, analytics, crash upload, or update pings. The only network capability that can ever exist is the explicitly enabled online dictionary adapter, with visible disclosure and local caching.
- No DRM circumvention: protected files get the calm message "This book appears to be protected and cannot be opened here."

## Verification

Malicious-fixture tests (Milestone 2 acceptance): script EPUB, remote-resource EPUB, `javascript:`-URL EPUB, CSS exfiltration attempt, malformed ZIP/PDF — all must render inert or fail with calm copy, with zero network attempts (asserted via devtools/network hooks in Playwright).
