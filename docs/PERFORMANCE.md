# Lectorium — Performance Measurements

Budgets are in [ARCHITECTURE.md](ARCHITECTURE.md#performance-budgets-measured-in-docsperformancemd). This file records **measured** results only — hardware, method, and numbers. No claimed or estimated values.

## Test hardware

- Machine: (record on first measurement) Windows 11 Home 10.0.26200, 27″ 2560×1440 external monitor target
- Note: development machine measurements are recorded per run below.

## Measurements

| Date | Build | Scenario | Result | Method | Notes |
|---|---|---|---|---|---|
| 2026-07-18 | dev (unoptimized) | EPUB open → visible text | ~2–4 s observed | manual, dev build | includes debug-build overhead + full-file fetch; measure on release build |
| 2026-07-18 | dev (unoptimized) | PDF page render (3-page fixture) | < 1 s per page observed | manual, dev build | ranged streaming confirmed (206 responses) |
| 2026-07-18 | dev (unoptimized) | Cold scan of **10,000** files (txt/md) incl. full BLAKE3 hashing | 76.8 s, ~130 files/s | `devtool bench-scan`, debug binary | background thread; UI stays responsive (short per-file locks). Debug build + per-file autocommit dominate — see bottleneck below |
| 2026-07-18 | dev (unoptimized) | Stacks with 10,000 rows | responsive | virtualized list renders ~40 rows regardless of count; query is `LIMIT 300` | scroll/search stay smooth |

Reader/launch budgets remain **unverified against a release build** — those numbers land when the release binary is profiled on the target 2560×1440 machine. Dev observations above are directional only, not claims.

## Known bottlenecks

- **Scan throughput (debug):** ~130 files/s is dominated by per-file SQLite autocommits (each `INSERT`/`UPDATE` in WAL mode fsyncs). This is a background operation and does not block the UI, but a release build plus batching inserts in periodic short transactions (~200 rows each, releasing between batches to keep reads responsive) should cut wall-clock scan time by roughly an order of magnitude. Tracked for a scanner optimization pass.
- EPUB opens by fetching the whole file into an ArrayBuffer (epub.js input). Fine for typical EPUBs; very large ones should stream or open via chunked source — revisit with a large-book fixture.
