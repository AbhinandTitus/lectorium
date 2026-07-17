# ADR 0003 — PDF engine: PDF.js with worker rendering and a derived Reflow view

Status: Accepted · Date: 2026-07-18

## Context

PDFs must render faithfully (fixed layout, embedded fonts, scanned pages), stay memory-bounded for very large files, and — for suitable text PDFs — offer a reversible in-app Reflow view that adopts Reader typography without touching the file. Night reading requires non-destructive dimming/recoloring.

## Decision

Use **Mozilla PDF.js** (worker-based) as the sole PDF renderer.

- **Original page view**: canvas render + text layer (selection/search) + annotation layer, virtualized to visible ± adjacent pages, LRU page cache with a hard memory budget, device-pixel-ratio-aware without unbounded canvas allocation. Page labels honored.
- **Reflow view**: a *derived presentation*, never a conversion. Built from `getTextContent()` items via conservative layout analysis (column detection, baseline clustering, font-size clusters, gap statistics, text-coverage ratio). Produces a semantic stream (headings/paragraphs/page anchors) rendered through the same typography/theme pipeline as EPUB. Low confidence ⇒ Reflow stays available but labeled experimental with a preview warning; default remains Original. Cache holds only rebuildable layout data.
- **Night presentation** (Original view): Original / Warm Dim (luminance-lowering overlay, no inversion) / Smart Dark (opt-in canvas recoloring of near-achromatic page+text that preserves photographs and colored figures, auto-fallback when page analysis predicts damage).
- **Cross-view locator**: `{ pageIndex, pageLabel, textQuote{exact,prefix,suffix}, pageXY normalized }` — resolves in both views deterministically (ADR 0004).

## Alternatives considered

- **PDFium (native, via Rust)** — faster raster, but no text/annotation layer for free, and shipping a second rendering pipeline duplicates selection/search/annotation work. Rejected for MVP; viable later behind the same view contract if performance demands it.
- **MuPDF** — AGPL licensing friction for a distributable app. Rejected.
- **Auto-conversion to EPUB** — explicitly forbidden by product spec (destructive). Never.

## Consequences

- Scanned/image-only pages: visual reading works; text tools report "This PDF page contains no selectable text." A local OCR adapter seam exists but is not a blocker.
- Broken/custom-encoded PDFs (notably some Malayalam PDFs): visual render stays faithful; search/copy/reflow must detect garbage extraction (codepoint sanity check) and report the limitation instead of returning corrupted text.
