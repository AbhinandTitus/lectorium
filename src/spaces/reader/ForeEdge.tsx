import { useEffect, useState } from "react";
import type { ReaderEngine, TocEntry } from "./engines/types";

/**
 * The fore-edge: a very thin right-side landmark with chapter notches and
 * the current position. Real navigation, not a progress reward —
 * percentages stay hidden; hover/focus reveals the chapter name.
 */
export function ForeEdge({
  engine,
  progress,
  onNavigate,
}: {
  engine: ReaderEngine;
  progress: number | null;
  onNavigate: (target: string) => void;
}) {
  const [entries, setEntries] = useState<TocEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void engine.toc().then((t) => {
      if (!cancelled) setEntries(t.filter((e) => e.depth === 0).slice(0, 60));
    });
    return () => {
      cancelled = true;
    };
  }, [engine]);

  if (entries.length === 0) return null;

  return (
    <nav className="fore-edge" aria-label="Chapters">
      {entries.map((e, i) => (
        <button
          key={i}
          className="fore-edge-notch"
          style={{ top: `${(i / entries.length) * 100}%` }}
          title={e.label}
          aria-label={e.label}
          onClick={() => onNavigate(e.target)}
        />
      ))}
      {progress !== null && (
        <div className="fore-edge-position" style={{ top: `${Math.min(99, progress * 100)}%` }} />
      )}
    </nav>
  );
}
