# Lectorium — Performance Measurements

Budgets are in [ARCHITECTURE.md](ARCHITECTURE.md#performance-budgets-measured-in-docsperformancemd). This file records **measured** results only — hardware, method, and numbers. No claimed or estimated values.

## Test hardware

- Machine: (record on first measurement) Windows 11 Home 10.0.26200, 27″ 2560×1440 external monitor target
- Note: development machine measurements are recorded per run below.

## Measurements

| Date | Build | Scenario | Result | Method | Notes |
|---|---|---|---|---|---|
| 2026-07-18 | dev (unoptimized) | EPUB open → visible text | ~2–4 s observed | manual, dev build | includes debug-build overhead + full-file fetch; measure properly on release build (M5) |
| 2026-07-18 | dev (unoptimized) | PDF page render (3-page fixture) | < 1 s per page observed | manual, dev build | ranged streaming confirmed (206 responses) |

Budgets remain **unverified** against release builds — real numbers land in M5 hardening on a release binary. Dev observations above are directional only, not claims.

## Known bottlenecks

- EPUB opens by fetching the whole file into an ArrayBuffer (epub.js input). Fine for typical EPUBs; very large ones should stream or open via chunked source — revisit at M5 with a large-book fixture.
