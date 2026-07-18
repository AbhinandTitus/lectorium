import { useEffect, useRef, useState } from "react";
import type { ReaderEngine, SearchHit } from "./engines/types";

/** In-book search (Ctrl+F). Results navigate; nothing is scored. */
export function SearchPanel({
  engine,
  onNavigate,
  onClose,
}: {
  engine: ReaderEngine;
  onNavigate: (target: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    const id = ++requestId.current;
    const t = setTimeout(() => {
      setBusy(true);
      void engine
        .search(q)
        .then((results) => {
          if (requestId.current === id) setHits(results);
        })
        .finally(() => {
          if (requestId.current === id) setBusy(false);
        });
    }, 350);
    return () => clearTimeout(t);
  }, [query, engine]);

  return (
    <aside className="reader-drawer" role="dialog" aria-label="Search this book">
      <header>
        <input
          ref={inputRef}
          type="search"
          placeholder="Search this book…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search this book"
        />
        <button onClick={onClose} aria-label="Close search">
          ×
        </button>
      </header>
      {busy && <p className="reader-drawer-note">Looking…</p>}
      {hits !== null && !busy && (
        <>
          <p className="reader-drawer-note">
            {hits.length === 0
              ? "Nothing found."
              : `${hits.length}${hits.length >= 200 ? "+" : ""} passages`}
          </p>
          <ol className="search-hits">
            {hits.map((h, i) => (
              <li key={i}>
                <button onClick={() => onNavigate(h.target)}>
                  <span className="search-hit-excerpt">{h.excerpt}</span>
                  {h.sectionTitle && <span className="search-hit-section">{h.sectionTitle}</span>}
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}
