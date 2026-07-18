import { useEffect, useRef } from "react";
import type { EngineSelection } from "./engines/types";

/**
 * Small non-blocking toolbar shown on text selection. Keyboard accessible;
 * dismissing never alters the selection. Define arrives with the dictionary
 * adapter later in M2.
 */
export function SelectionToolbar({
  selection,
  onHighlight,
  onNote,
  onDefine,
  onKeep,
  onCopy,
  onDismiss,
}: {
  selection: EngineSelection;
  onHighlight: () => void;
  onNote: () => void;
  onDefine: () => void;
  onKeep: () => void;
  onCopy: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const top = Math.max(8, selection.rect.y - 44);
  const left = Math.max(8, selection.rect.x + selection.rect.width / 2 - 130);

  return (
    <div
      ref={ref}
      className="selection-toolbar"
      style={{ top, left }}
      role="toolbar"
      aria-label="Selection tools"
    >
      <button onClick={onHighlight}>Highlight</button>
      <button onClick={onNote}>Note</button>
      <button onClick={onDefine}>Define</button>
      <button onClick={onKeep}>Keep</button>
      <button onClick={onCopy}>Copy</button>
    </div>
  );
}
