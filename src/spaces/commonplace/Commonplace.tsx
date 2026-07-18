import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigation } from "../../state/navigation";
import * as cp from "../../services/commonplace";
import { inTauri } from "../../services/library";
import { Recall } from "./Recall";
import "./commonplace.css";

type View = "entries" | "recall";

const KIND_LABEL: Record<string, string> = {
  quote: "Quote",
  idea: "Idea",
  question: "Question",
  vocabulary: "Vocabulary",
  action: "Action",
  character: "Character",
  free: "Note",
  note: "Note",
  highlight: "Highlight",
};

/**
 * The Commonplace: a real intellectual artifact over the entries the reader
 * already kept (docs/PRODUCT.md). Search across one's own notes and quotes,
 * filter by reader-defined headings, create explicit cross-links, export as
 * Markdown/JSON, and an opt-in non-scored Recall view.
 */
export function Commonplace() {
  const goTo = useNavigation((s) => s.goTo);
  const openBook = useNavigation((s) => s.openBook);

  const [view, setView] = useState<View>("entries");
  const [entries, setEntries] = useState<cp.CommonplaceEntry[]>([]);
  const [headings, setHeadings] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [heading, setHeading] = useState("");
  const [kind, setKind] = useState("");
  const [linking, setLinking] = useState<cp.CommonplaceEntry | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!inTauri()) return;
    void cp
      .listCommonplace({
        search: search || undefined,
        heading: heading || undefined,
        kind: kind || undefined,
      })
      .then(setEntries);
  }, [search, heading, kind]);

  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (inTauri()) void cp.listHeadings().then(setHeadings);
  }, [entries.length]);

  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  const doExport = useCallback(() => {
    void cp.exportCommonplace().then((dir) => {
      if (dir) setExportNote(`Exported to ${dir}`);
    });
  }, []);

  const toggleLink = useCallback(
    async (a: cp.CommonplaceEntry, b: cp.CommonplaceEntry) => {
      if (a.linkedIds.includes(b.id)) {
        await cp.unlinkEntries(a.id, b.id);
      } else {
        await cp.linkEntries(a.id, b.id);
      }
      setLinking(null);
      load();
    },
    [load],
  );

  if (view === "recall") {
    return <Recall onExit={() => setView("entries")} onOpenBook={openBook} />;
  }

  return (
    <main className="commonplace" aria-label="Commonplace">
      <header className="cp-bar">
        <button className="cp-back" onClick={() => goTo("room")} aria-label="Back to the room">
          ← Room
        </button>
        <input
          className="cp-search"
          type="search"
          placeholder="Search your quotes, notes, headings…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search the commonplace"
        />
        <select
          value={heading}
          onChange={(e) => setHeading(e.target.value)}
          aria-label="Filter by heading"
        >
          <option value="">All headings</option>
          {headings.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter by kind">
          <option value="">All kinds</option>
          {["quote", "idea", "question", "action", "character", "note", "highlight"].map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <button className="cp-recall" onClick={() => setView("recall")}>
          Recall
        </button>
        <button className="cp-export" onClick={doExport}>
          Export
        </button>
      </header>

      {exportNote && (
        <p className="cp-export-note" role="status">
          {exportNote}
          <button onClick={() => setExportNote(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      )}

      {entries.length === 0 ? (
        <div className="cp-empty">
          <p>Nothing kept yet.</p>
          <p className="cp-empty-hint">
            While reading, select a passage and choose <em>Keep</em> to bring it here.
          </p>
        </div>
      ) : (
        <ul className="cp-list">
          {entries.map((e) => (
            <li key={e.id} className="cp-entry">
              <div className="cp-entry-head">
                <span className="cp-kind">{KIND_LABEL[e.kind] ?? e.kind}</span>
                {e.commonplaceHeading && <span className="cp-heading">{e.commonplaceHeading}</span>}
              </div>
              {e.exactQuote && (
                <blockquote lang={e.engineType === "epub" ? undefined : undefined}>
                  {e.exactQuote}
                </blockquote>
              )}
              {e.note && <p className="cp-note">{e.note}</p>}
              <div className="cp-source">
                <button className="cp-source-link" onClick={() => openBook(e.bookId)}>
                  {e.bookTitle}
                  {e.bookAuthors[0] ? `, ${e.bookAuthors[0]}` : ""}
                  {e.sectionTitle ? ` · ${e.sectionTitle}` : ""}
                </button>
              </div>
              {e.linkedIds.length > 0 && (
                <div className="cp-links" aria-label="Connections">
                  {e.linkedIds.map((id) => {
                    const linked = byId.get(id);
                    return (
                      <span key={id} className="cp-link-chip" title={linked?.exactQuote ?? ""}>
                        ↔ {linked?.commonplaceHeading ?? linked?.bookTitle ?? "linked"}
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="cp-entry-actions">
                <button onClick={() => setLinking(linking?.id === e.id ? null : e)}>
                  {linking?.id === e.id ? "Choose a connection…" : "Connect"}
                </button>
              </div>

              {linking && linking.id !== e.id && (
                <button className="cp-link-target" onClick={() => void toggleLink(linking, e)}>
                  {linking.linkedIds.includes(e.id) ? "Unlink from selected" : "Link to selected"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
