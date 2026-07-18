import { useCallback, useEffect, useRef, useState } from "react";
import type { BookSummary, DeskConflict, DeskRole } from "../../services/types";
import * as lib from "../../services/library";
import { useLibrary } from "../../state/library";
import { useNavigation } from "../../state/navigation";
import { BookCover } from "../../components/BookCover";
import "./stacks.css";

const PAGE = 300;

type StatusFilter = "" | "desk" | "paused" | "completed" | "reference";

/** The fast 2D library. Search, filter, preview, place on desk. */
export function Stacks() {
  const goTo = useNavigation((s) => s.goTo);
  const openBook = useNavigation((s) => s.openBook);
  const { scanning, scanNote, refreshTick, refreshDesk } = useLibrary();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [format, setFormat] = useState("");
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [selected, setSelected] = useState<BookSummary | null>(null);
  const [conflict, setConflict] = useState<(DeskConflict & { bookId: string }) | null>(null);

  const query = useCallback(
    async (offset: number) => {
      if (!lib.inTauri()) return [];
      return lib.listBooks({
        search: search || undefined,
        status: status || undefined,
        format: format || undefined,
        limit: PAGE,
        offset,
      });
    },
    [search, status, format],
  );

  // initial + reactive load (debounced for typing)
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      void query(0).then((rows) => {
        if (!cancelled) {
          setBooks(rows);
          setExhausted(rows.length < PAGE);
        }
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, refreshTick]);

  const loadMore = useCallback(() => {
    void query(books.length).then((rows) => {
      setBooks((prev) => [...prev, ...rows]);
      setExhausted(rows.length < PAGE);
    });
  }, [query, books.length]);

  const place = useCallback(
    async (book: BookSummary, role: DeskRole, replace = false) => {
      const conflictInfo = await lib.setDeskRole(book.id, role, replace);
      if (conflictInfo) {
        setConflict({ ...conflictInfo, bookId: book.id });
      } else {
        setConflict(null);
        await refreshDesk();
        useLibrary.setState((s) => ({ refreshTick: s.refreshTick + 1 }));
      }
    },
    [refreshDesk],
  );

  return (
    <main className="stacks" aria-label="Stacks">
      <header className="stacks-bar">
        <button className="stacks-back" onClick={() => goTo("room")} aria-label="Back to the room">
          ← Room
        </button>
        <input
          className="stacks-search"
          type="search"
          placeholder="Search title, author, filename…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search the library"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          aria-label="Filter by shelf"
        >
          <option value="">All shelves</option>
          <option value="desk">On desk</option>
          <option value="paused">Paused</option>
          <option value="completed">Completed</option>
          <option value="reference">Reference</option>
        </select>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          aria-label="Filter by format"
        >
          <option value="">All formats</option>
          <option value="epub">EPUB</option>
          <option value="pdf">PDF</option>
          <option value="txt">TXT</option>
          <option value="md">Markdown</option>
        </select>
        <button
          className="stacks-addfolder"
          onClick={() => void lib.chooseAndAddLibraryRoot()}
          title="Add another book folder"
        >
          Add folder
        </button>
      </header>

      {(scanning || scanNote) && (
        <p className="stacks-scan-note" role="status">
          {scanNote}
        </p>
      )}

      <div className="stacks-body">
        <VirtualBookList
          books={books}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
          onOpen={(b) => openBook(b.id)}
          exhausted={exhausted}
          onLoadMore={loadMore}
        />

        {selected && (
          <aside className="stacks-drawer" aria-label={`Details for ${selected.title}`}>
            <button
              className="drawer-close"
              onClick={() => setSelected(null)}
              aria-label="Close details"
            >
              ×
            </button>
            <div className="drawer-cover">
              <BookCover book={selected} size="large" />
            </div>
            <h2 lang={selected.language ?? undefined}>{selected.title}</h2>
            {selected.authors.length > 0 && (
              <p className="drawer-authors">{selected.authors.join(", ")}</p>
            )}
            <p className="drawer-format">
              {selected.sourceFormat.toUpperCase()}
              {selected.missing && " — this file moved"}
            </p>

            {selected.missing ? (
              <button
                className="drawer-primary"
                onClick={() => {
                  void (async () => {
                    const path = await lib.chooseRelinkFile();
                    if (path) {
                      await lib.relinkBook(selected.id, path);
                      useLibrary.setState((s) => ({ refreshTick: s.refreshTick + 1 }));
                      setSelected({ ...selected, missing: false });
                    }
                  })();
                }}
              >
                Find this file
              </button>
            ) : (
              <>
                <button className="drawer-primary" onClick={() => openBook(selected.id)}>
                  Open
                </button>
                <div className="drawer-desk" role="group" aria-label="Place on desk">
                  <span>Place on desk as</span>
                  <div>
                    <button onClick={() => void place(selected, "current")}>Current</button>
                    <button onClick={() => void place(selected, "companion")}>Companion</button>
                    <button onClick={() => void place(selected, "short")}>Short</button>
                  </div>
                </div>
                <div className="drawer-status" role="group" aria-label="Move to shelf">
                  <button
                    onClick={() => void lib.setBookStatus(selected.id, "shelf").then(refreshDesk)}
                  >
                    Return to shelf
                  </button>
                  <button
                    onClick={() => void lib.setBookStatus(selected.id, "paused").then(refreshDesk)}
                  >
                    Pause
                  </button>
                  <button
                    onClick={() =>
                      void lib.setBookStatus(selected.id, "completed").then(refreshDesk)
                    }
                  >
                    Completed
                  </button>
                  <button
                    onClick={() =>
                      void lib.setBookStatus(selected.id, "reference").then(refreshDesk)
                    }
                  >
                    Reference
                  </button>
                </div>
              </>
            )}
          </aside>
        )}
      </div>

      {conflict && (
        <div className="desk-conflict" role="alertdialog" aria-label="The desk is full">
          <p>
            <strong>{conflict.occupantTitle}</strong> is already on the desk as {conflict.role}.
          </p>
          <p>Return it to the shelf and place this book instead?</p>
          <div className="desk-conflict-actions">
            <button
              onClick={() => {
                const book = books.find((b) => b.id === conflict.bookId) ?? selected;
                if (book) void place(book, conflict.role, true);
              }}
            >
              Yes, swap them
            </button>
            <button onClick={() => setConflict(null)}>Keep things as they are</button>
          </div>
        </div>
      )}
    </main>
  );
}

const ROW_HEIGHT = 72;
const OVERSCAN = 8;

function VirtualBookList({
  books,
  selectedId,
  onSelect,
  onOpen,
  exhausted,
  onLoadMore,
}: {
  books: BookSummary[];
  selectedId: string | null;
  onSelect: (b: BookSummary) => void;
  onOpen: (b: BookSummary) => void;
  exhausted: boolean;
  onLoadMore: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 40 });

  const recompute = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const start = Math.max(0, Math.floor(el.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(
      books.length,
      Math.ceil((el.scrollTop + el.clientHeight) / ROW_HEIGHT) + OVERSCAN,
    );
    setRange((r) => (r.start === start && r.end === end ? r : { start, end }));
    if (!exhausted && el.scrollTop + el.clientHeight > books.length * ROW_HEIGHT - 600) {
      onLoadMore();
    }
  }, [books.length, exhausted, onLoadMore]);

  useEffect(recompute, [recompute]);

  if (books.length === 0) {
    return (
      <div className="stacks-empty">
        <p>Nothing here yet.</p>
        <p className="stacks-empty-hint">
          Add a book folder and the shelves will fill quietly in the background.
        </p>
      </div>
    );
  }

  const visible = books.slice(range.start, range.end);
  return (
    <div
      className="stacks-list"
      ref={scrollRef}
      onScroll={recompute}
      role="list"
      aria-label="Books"
    >
      <div style={{ height: books.length * ROW_HEIGHT, position: "relative" }}>
        {visible.map((book, i) => {
          const index = range.start + i;
          return (
            <div
              key={book.id}
              role="listitem"
              className={`stacks-row${book.id === selectedId ? " is-selected" : ""}${book.missing ? " is-missing" : ""}`}
              style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
            >
              <button
                className="stacks-row-main"
                onClick={() => onSelect(book)}
                onDoubleClick={() => !book.missing && onOpen(book)}
              >
                <BookCover book={book} size="small" />
                <span className="stacks-row-text">
                  <span className="stacks-row-title" lang={book.language ?? undefined}>
                    {book.title}
                  </span>
                  <span className="stacks-row-meta">
                    {book.authors[0] ?? ""}
                    {book.missing
                      ? " · this file moved"
                      : book.deskRole
                        ? ` · on desk (${book.deskRole})`
                        : ""}
                  </span>
                </span>
                <span className="stacks-row-format">{book.sourceFormat.toUpperCase()}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
