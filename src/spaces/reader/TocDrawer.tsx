import { useEffect, useState } from "react";
import type { ReaderEngine, TocEntry } from "./engines/types";

/** Table of contents / section map (T). Real navigation, not a reward. */
export function TocDrawer({
  engine,
  currentSection,
  onNavigate,
  onClose,
}: {
  engine: ReaderEngine;
  currentSection: string | null;
  onNavigate: (target: string) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<TocEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void engine.toc().then((t) => {
      if (!cancelled) setEntries(t);
    });
    return () => {
      cancelled = true;
    };
  }, [engine]);

  return (
    <aside className="reader-drawer" role="dialog" aria-label="Contents">
      <header>
        <h2>Contents</h2>
        <button onClick={onClose} aria-label="Close contents">
          ×
        </button>
      </header>
      {entries === null ? (
        <p className="reader-drawer-note">Reading the map…</p>
      ) : entries.length === 0 ? (
        <p className="reader-drawer-note">This book has no table of contents.</p>
      ) : (
        <ol className="toc-list">
          {entries.map((e, i) => (
            <li key={i} style={{ paddingLeft: `${e.depth * 0.9}rem` }}>
              <button
                className={e.label === currentSection ? "is-current" : ""}
                onClick={() => onNavigate(e.target)}
              >
                {e.label}
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
