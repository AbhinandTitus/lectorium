import { useEffect, useMemo, useState } from "react";
import { identity } from "../config/identity";
import { applyTheme, type ThemeName } from "../config/tokens";
import * as lib from "../services/library";
import { useLibrary } from "../state/library";
import "./onboarding.css";
import type { BookSummary } from "../services/types";

/**
 * Three screens, every optional step skippable. No calibration, no goals,
 * no tutorial carousel — those live behind "Make the page fit me" later.
 */
export function Onboarding() {
  const { updateSettings, settings } = useLibrary();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [folderChosen, setFolderChosen] = useState(false);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (step !== 2 || !lib.inTauri()) return;
    let disposed = false;
    const load = () => {
      void lib.listBooks({ limit: 100 }).then((items) => {
        if (!disposed) setBooks(items.filter((book) => !book.missing));
      });
    };
    load();
    const timer = window.setInterval(load, 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [step]);

  const choices = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return books;
    return books.filter(
      (book) =>
        book.title.toLocaleLowerCase().includes(query) ||
        book.authors.some((author) => author.toLocaleLowerCase().includes(query)),
    );
  }, [books, search]);

  const finish = async (theme: ThemeName) => {
    applyTheme(theme);
    await updateSettings({ theme, onboarded: true });
  };

  return (
    <main className="onboarding" aria-label={`Welcome to ${identity.name}`}>
      <div className="onboarding-card">
        {step === 1 && (
          <>
            <h1>{identity.name}</h1>
            <p className="onboarding-tagline">{identity.tagline}</p>
            <p>
              Choose the folder where your books live. Your books and notes stay on this computer.
            </p>
            <div className="onboarding-actions">
              <button
                className="onboarding-primary"
                onClick={() => {
                  void lib.chooseAndAddLibraryRoot().then((root) => {
                    if (root) {
                      setFolderChosen(true);
                      setStep(2);
                    }
                  });
                }}
              >
                Choose a book folder
              </button>
              <button className="onboarding-skip" onClick={() => setStep(2)}>
                Later
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1>One book on the desk</h1>
            <p>
              Choose the book you most want to return to — not the book you think you should read.
              {folderChosen &&
                " The shelves are filling in the background; new books appear here as they are found."}
            </p>
            {books.length > 0 && (
              <>
                <input
                  className="onboarding-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Find a title or author"
                  aria-label="Find a book for the desk"
                />
                <ul className="onboarding-books">
                  {choices.slice(0, 8).map((book) => (
                    <li key={book.id}>
                      <button
                        onClick={() => {
                          void lib.setDeskRole(book.id, "current", true).then(() => setStep(3));
                        }}
                      >
                        <strong>{book.title}</strong>
                        {book.authors[0] && <span>{book.authors[0]}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="onboarding-actions">
              <button className="onboarding-skip" onClick={() => setStep(3)}>
                Continue without choosing
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1>Day or night?</h1>
            <p>
              For night reading: a dim, warm room lamp and the lowest comfortable monitor brightness
              help more than any software theme. A glowing monitor is not paper or e-ink near
              bedtime — {identity.name} will stay warm and dark, and that is an honest limit.
            </p>
            <div className="onboarding-actions">
              <button
                className="onboarding-primary"
                onClick={() => void finish(settings.theme === "paper" ? "paper" : "ember")}
              >
                Begin in {settings.theme === "paper" ? "Paper" : "Ember"}
              </button>
              <button
                className="onboarding-skip"
                onClick={() => void finish(settings.theme === "paper" ? "ember" : "paper")}
              >
                Use {settings.theme === "paper" ? "Ember" : "Paper"} instead
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
