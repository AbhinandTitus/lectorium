import type { Annotation } from "../../services/annotations";
import { parseEnvelope, takeGraphemes, type LocatorEnvelope } from "./locator";
import { useState } from "react";

const KIND_LABEL: Record<string, string> = {
  bookmark: "Bookmark",
  highlight: "Highlight",
  note: "Note",
  quote: "Kept passage",
  idea: "Idea",
  question: "Question",
  action: "Action",
  character: "Character",
};

export function AnnotationsDrawer({
  annotations,
  onNavigate,
  onDelete,
  onClose,
}: {
  annotations: Annotation[];
  onNavigate: (locator: LocatorEnvelope) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const visible = annotations.filter((item) => item.kind !== "vocabulary");
  return (
    <aside className="reader-drawer" role="dialog" aria-label="Bookmarks and notes">
      <header>
        <h2>Bookmarks & notes</h2>
        <button onClick={onClose} aria-label="Close bookmarks and notes">
          ×
        </button>
      </header>
      {visible.length === 0 ? (
        <p className="reader-drawer-note">No bookmarks or notes in this book yet.</p>
      ) : (
        <ul className="annotation-list">
          {visible.map((item) => {
            const locator = parseEnvelope(item.startLocatorJson);
            const source = locator?.coarse.sectionTitle;
            const preview = item.note ?? item.exactQuote ?? source ?? "Saved reading place";
            return (
              <li key={item.id}>
                <button
                  className="annotation-open"
                  disabled={!locator}
                  onClick={() => locator && onNavigate(locator)}
                >
                  <span>{KIND_LABEL[item.kind] ?? "Note"}</span>
                  <span>{takeGraphemes(preview, 90)}</span>
                  {source && source !== preview && <small>{source}</small>}
                </button>
                <button
                  className="annotation-delete"
                  onClick={() => {
                    if (pendingDelete === item.id) {
                      onDelete(item.id);
                      setPendingDelete(null);
                    } else {
                      setPendingDelete(item.id);
                    }
                  }}
                  aria-label={`Delete ${KIND_LABEL[item.kind]?.toLowerCase() ?? "note"}`}
                >
                  {pendingDelete === item.id ? "Delete?" : "Delete"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
