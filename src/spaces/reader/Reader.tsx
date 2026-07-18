import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyTheme, type ThemeName } from "../../config/tokens";
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  presets,
  type PresetName,
  type TypographySettings,
} from "../../config/typography";
import * as lib from "../../services/library";
import type { BookDetail } from "../../services/types";
import { useLibrary } from "../../state/library";
import { useNavigation } from "../../state/navigation";
import type { LocatorEnvelope } from "./locator";
import { parseEnvelope, serializeEnvelope } from "./locator";
import type { LocatorContext, ReaderEngine } from "./engines/types";
import "./reader.css";

const CHROME_FADE_MS = 2500;
const AUTOSAVE_DEBOUNCE_MS = 800;
/** show the re-entry ribbon after this long away */
const RIBBON_GAP_MS = 4 * 60 * 60 * 1000;

/** Engines load lazily so epub.js / PDF.js never weigh down app launch. */
async function makeEngine(format: string): Promise<ReaderEngine> {
  switch (format) {
    case "epub": {
      const { EpubEngine } = await import("./engines/epubEngine");
      return new EpubEngine();
    }
    case "pdf": {
      const { PdfEngine } = await import("./engines/pdfEngine");
      return new PdfEngine();
    }
    default: {
      const { TextEngine } = await import("./engines/textEngine");
      return new TextEngine();
    }
  }
}

export function Reader() {
  const bookId = useNavigation((s) => s.openBookId);
  const closeBook = useNavigation((s) => s.closeBook);
  const { settings, updateSettings } = useLibrary();

  const [book, setBook] = useState<BookDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [ribbon, setRibbon] = useState<{ title: string; section: string | null } | null>(null);
  const [sectionTitle, setSectionTitle] = useState<string | null>(null);
  const [fontDelta, setFontDelta] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ReaderEngine | null>(null);
  const saveTimer = useRef<number | null>(null);
  const pendingSave = useRef<{ locator: LocatorEnvelope; context: LocatorContext } | null>(null);
  const chromeTimer = useRef<number | null>(null);

  const typography: TypographySettings = useMemo(() => {
    const base = presets[settings.typographyPreset];
    const fontSizePx = Math.min(
      FONT_SIZE_MAX,
      Math.max(FONT_SIZE_MIN, base.fontSizePx + fontDelta),
    );
    return { ...base, fontSizePx };
  }, [settings.typographyPreset, fontDelta]);

  const flushSave = useCallback(() => {
    if (!pendingSave.current || !bookId) return;
    const { locator, context } = pendingSave.current;
    pendingSave.current = null;
    void lib.saveLocation(bookId, {
      engineType: locator.engine,
      locatorJson: serializeEnvelope(locator),
      sectionTitle: context.sectionTitle,
      pageIndex: context.pageIndex,
    });
  }, [bookId]);

  const onLocatorChanged = useCallback(
    (locator: LocatorEnvelope, context: LocatorContext) => {
      pendingSave.current = { locator, context };
      setSectionTitle(context.sectionTitle);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flushSave, AUTOSAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  // open the book
  useEffect(() => {
    if (!bookId || !containerRef.current) return;
    let disposed = false;
    const container = containerRef.current;

    void (async () => {
      try {
        const detail = await lib.getBook(bookId);
        if (disposed) return;
        setBook(detail);

        const lastOpened = detail.lastOpenedAt ? Date.parse(detail.lastOpenedAt) : null;
        if (lastOpened && Date.now() - lastOpened > RIBBON_GAP_MS && detail.location) {
          setRibbon({ title: detail.title, section: detail.location.sectionTitle });
        }

        const engine = await makeEngine(detail.readingFormat);
        if (disposed) return;
        engineRef.current = engine;
        await engine.open({
          container,
          book: detail,
          fileUrl: lib.bookFileUrl(detail.id),
          typography,
          theme: settings.theme,
          onLocatorChanged,
        });
        if (disposed) {
          engine.destroy();
          return;
        }
        const saved = detail.location ? parseEnvelope(detail.location.locatorJson) : null;
        await engine.display(saved);
        await lib.markOpened(detail.id);
      } catch (e) {
        tracingError(e);
        if (!disposed) {
          setError("Lectorium could not read this file. Your original was not changed.");
        }
      }
    })();

    return () => {
      disposed = true;
      flushSave();
      engineRef.current?.destroy();
      engineRef.current = null;
    };
    // typography/theme changes are applied through engine methods, not reopen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // live typography / theme updates
  useEffect(() => {
    engineRef.current?.applyTypography(typography);
  }, [typography]);
  useEffect(() => {
    engineRef.current?.applyTheme(settings.theme);
  }, [settings.theme]);

  // flush the save on blur / hide / close
  useEffect(() => {
    const flush = () => flushSave();
    window.addEventListener("blur", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("blur", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [flushSave]);

  // chrome fade
  const wakeChrome = useCallback(() => {
    setChromeVisible(true);
    if (chromeTimer.current) window.clearTimeout(chromeTimer.current);
    chromeTimer.current = window.setTimeout(() => setChromeVisible(false), CHROME_FADE_MS);
  }, []);
  useEffect(() => {
    wakeChrome();
    return () => {
      if (chromeTimer.current) window.clearTimeout(chromeTimer.current);
    };
  }, [wakeChrome]);

  const dismissRibbon = useCallback(() => setRibbon(null), []);

  const turn = useCallback(
    (dir: 1 | -1) => {
      dismissRibbon();
      const engine = engineRef.current;
      if (!engine) return;
      void (dir === 1 ? engine.next() : engine.prev());
    },
    [dismissRibbon],
  );

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      wakeChrome();
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
          turn(1);
          e.preventDefault();
          break;
        case "ArrowLeft":
        case "PageUp":
          turn(-1);
          e.preventDefault();
          break;
        case " ":
          turn(e.shiftKey ? -1 : 1);
          e.preventDefault();
          break;
        case "f":
        case "F":
          void toggleFullscreen();
          break;
        case "a":
        case "A":
          setSheetOpen((v) => !v);
          break;
        case "Escape":
          if (sheetOpen) {
            setSheetOpen(false);
          } else if (document.fullscreenElement) {
            void document.exitFullscreen();
          }
          // Esc never closes the book
          break;
        case "+":
        case "=":
          if (e.ctrlKey) {
            setFontDelta((d) => Math.min(d + 1, FONT_SIZE_MAX));
            e.preventDefault();
          }
          break;
        case "-":
          if (e.ctrlKey) {
            setFontDelta((d) => Math.max(d - 1, -FONT_SIZE_MAX));
            e.preventDefault();
          }
          break;
        case "0":
          if (e.ctrlKey) {
            setFontDelta(0);
            e.preventDefault();
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turn, sheetOpen, wakeChrome]);

  if (!bookId) {
    return (
      <main className="reader reader-empty" aria-label="Reader">
        <p>No book is open.</p>
        <button onClick={closeBook}>Back to the room</button>
      </main>
    );
  }

  return (
    <main
      className="reader"
      aria-label={book ? `Reading ${book.title}` : "Reader"}
      onMouseMove={wakeChrome}
      onClick={dismissRibbon}
    >
      <header className={`reader-chrome reader-chrome-top${chromeVisible ? "" : " is-hidden"}`}>
        <button
          onClick={() => {
            flushSave();
            closeBook();
          }}
        >
          ← Room
        </button>
        <span className="reader-chrome-title">
          {book?.title}
          {sectionTitle ? ` — ${sectionTitle}` : ""}
        </span>
        <button onClick={() => setSheetOpen((v) => !v)} aria-label="Appearance">
          Aa
        </button>
      </header>

      {error ? (
        <div className="reader-error" role="alert">
          <p>{error}</p>
          <button onClick={closeBook}>Back to the room</button>
        </div>
      ) : (
        <div className="reader-stage">
          <button
            className="reader-turn reader-turn-prev"
            onClick={() => turn(-1)}
            aria-label="Previous page"
            tabIndex={-1}
          />
          <div
            className="reader-page-host"
            ref={containerRef}
            style={
              book && book.readingFormat !== "pdf"
                ? // measure limit: ~0.53em average glyph width for the serif
                  // stacks; refined per-font at M2 calibration
                  {
                    maxWidth: `${Math.round(typography.maxWidthCh * 0.53 * typography.fontSizePx)}px`,
                  }
                : undefined
            }
          />
          <button
            className="reader-turn reader-turn-next"
            onClick={() => turn(1)}
            aria-label="Next page"
            tabIndex={-1}
          />
        </div>
      )}

      {ribbon && (
        <aside className="reader-ribbon" onClick={dismissRibbon}>
          <span className="reader-ribbon-title">{ribbon.title}</span>
          {ribbon.section && <span className="reader-ribbon-section">{ribbon.section}</span>}
        </aside>
      )}

      {sheetOpen && (
        <AppearanceSheet
          theme={settings.theme}
          preset={settings.typographyPreset}
          onTheme={(theme) => {
            applyTheme(theme);
            void updateSettings({ theme });
          }}
          onPreset={(typographyPreset) => void updateSettings({ typographyPreset })}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </main>
  );
}

function AppearanceSheet({
  theme,
  preset,
  onTheme,
  onPreset,
  onClose,
}: {
  theme: ThemeName;
  preset: PresetName;
  onTheme: (t: ThemeName) => void;
  onPreset: (p: PresetName) => void;
  onClose: () => void;
}) {
  return (
    <aside className="appearance-sheet" role="dialog" aria-label="Appearance">
      <div className="appearance-row" role="group" aria-label="Theme">
        <span>Theme</span>
        <div>
          <button className={theme === "paper" ? "is-active" : ""} onClick={() => onTheme("paper")}>
            Paper
          </button>
          <button className={theme === "ember" ? "is-active" : ""} onClick={() => onTheme("ember")}>
            Ember
          </button>
        </div>
      </div>
      <div className="appearance-row" role="group" aria-label="Typography preset">
        <span>Page</span>
        <div>
          {(Object.keys(presets) as PresetName[]).map((name) => (
            <button
              key={name}
              className={preset === name ? "is-active" : ""}
              onClick={() => onPreset(name)}
            >
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <p className="appearance-hint">Ctrl + / Ctrl − adjust text size · Esc closes</p>
      <button className="appearance-close" onClick={onClose} aria-label="Close appearance">
        ×
      </button>
    </aside>
  );
}

async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await document.documentElement.requestFullscreen();
  }
}

function tracingError(e: unknown): void {
  console.error("[reader]", e);
}
