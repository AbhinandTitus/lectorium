export interface EpubProgressPosition {
  index: number;
  percentage?: number;
  displayed?: {
    page: number;
    total: number;
  };
}

export function normalizeProgress(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/**
 * Prefer epub.js's text-length-based location percentage. While locations are
 * still being generated, fall back to the visible page within the spine item.
 * This estimate is display-only and is never used to restore a location.
 */
export function epubReadingProgress(
  position: EpubProgressPosition,
  spineCount: number,
  atEnd = false,
): number | null {
  const exact = normalizeProgress(position.percentage);
  if (exact !== null) return exact;
  if (!Number.isInteger(position.index) || position.index < 0 || spineCount < 1) return null;

  const page = position.displayed?.page;
  const total = position.displayed?.total;
  let withinSection = 0;
  if (
    typeof page === "number" &&
    Number.isFinite(page) &&
    typeof total === "number" &&
    Number.isFinite(total) &&
    total > 1
  ) {
    withinSection = Math.min(1, Math.max(0, (page - 1) / (total - 1)));
  } else if (atEnd && position.index >= spineCount - 1) {
    withinSection = 1;
  }

  return normalizeProgress((Math.min(position.index, spineCount - 1) + withinSection) / spineCount);
}

export function roundedProgressPercent(progress: number | null | undefined): number | null {
  const normalized = normalizeProgress(progress);
  return normalized === null ? null : Math.round(normalized * 100);
}
