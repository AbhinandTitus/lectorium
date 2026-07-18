import { useCallback, useEffect, useState } from "react";
import * as cp from "../../services/commonplace";
import { inTauri } from "../../services/library";

/**
 * Opt-in Recall (docs/PRODUCT.md). Shows the reader's own cue/heading first
 * and asks "What do you remember?" After they think or type, Reveal shows
 * the passage and note. No grades, percentages, streaks, or due-date shame.
 * Spacing quietly schedules when an entry returns; the schedule is hidden.
 */
export function Recall({
  onExit,
  onOpenBook,
}: {
  onExit: () => void;
  onOpenBook: (bookId: string) => void;
}) {
  const [items, setItems] = useState<cp.RecallItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [response, setResponse] = useState("");

  useEffect(() => {
    if (!inTauri()) {
      setItems([]);
      return;
    }
    void cp.recallAvailable(20).then(setItems);
  }, []);

  const current = items?.[index] ?? null;

  const advance = useCallback(
    (remembered: boolean) => {
      if (!current) return;
      void cp.recordRecall(current.annotationId, response.trim() || null, remembered);
      setResponse("");
      setRevealed(false);
      setIndex((i) => i + 1);
    },
    [current, response],
  );

  if (items === null) {
    return <main className="commonplace recall" aria-label="Recall" />;
  }

  if (items.length === 0 || index >= items.length) {
    return (
      <main className="commonplace recall" aria-label="Recall">
        <div className="recall-done">
          <p>
            {items.length === 0
              ? "Nothing waiting for recall right now."
              : "That's everything for now."}
          </p>
          <p className="recall-done-hint">
            Recall stays quiet — entries return on their own, with no streaks to keep.
          </p>
          <button onClick={onExit}>Back to the commonplace</button>
        </div>
      </main>
    );
  }

  return (
    <main className="commonplace recall" aria-label="Recall">
      <div className="recall-card">
        <p className="recall-progress" aria-hidden="true">
          {index + 1} / {items.length}
        </p>
        <p className="recall-cue">{current!.cue}</p>

        {!revealed ? (
          <>
            <p className="recall-prompt">What do you remember?</p>
            <textarea
              autoFocus
              rows={3}
              placeholder="Think, or jot a line (optional)"
              value={response}
              onChange={(e) => setResponse(e.target.value)}
            />
            <div className="recall-actions">
              <button className="recall-primary" onClick={() => setRevealed(true)}>
                Reveal
              </button>
              <button onClick={onExit}>Stop</button>
            </div>
          </>
        ) : (
          <>
            {current!.exactQuote && (
              <blockquote className="recall-passage">{current!.exactQuote}</blockquote>
            )}
            {current!.note && <p className="recall-note">{current!.note}</p>}
            <button className="recall-source" onClick={() => onOpenBook(current!.bookId)}>
              {current!.bookTitle}
            </button>
            <div className="recall-actions">
              <button onClick={() => advance(false)}>Bring back sooner</button>
              <button className="recall-primary" onClick={() => advance(true)}>
                Keep going
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
