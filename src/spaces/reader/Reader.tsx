import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { applyTheme, type ThemeName } from "../../config/tokens";
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  presets,
  type PresetName,
  type TypographySettings,
} from "../../config/typography";
import * as lib from "../../services/library";
import * as ann from "../../services/annotations";
import type { BookDetail, ReadingMode } from "../../services/types";
import { useLibrary } from "../../state/library";
import { useNavigation } from "../../state/navigation";
import type { LocatorEnvelope } from "./locator";
import { graphemes, parseEnvelope, serializeEnvelope, takeGraphemes } from "./locator";
import type { EngineSelection, LocatorContext, ReaderEngine } from "./engines/types";
import { SelectionToolbar } from "./SelectionToolbar";
import { TocDrawer } from "./TocDrawer";
import { SearchPanel } from "./SearchPanel";
import { ForeEdge } from "./ForeEdge";
import { AnnotationsDrawer } from "./AnnotationsDrawer";
import { ReadingProgress } from "./ReadingProgress";
import { Calibration } from "./Calibration";
import {
  define,
  dictionaryContext,
  dictionaryTermFromSelection,
  normalizeDictionaryTerm,
  type DefineResult,
} from "../../services/dictionary";
import { addVocabulary } from "../../services/commonplace";
import { useQuietNight } from "../../config/useQuietNight";
import "./reader.css";

const CHROME_FADE_MS = 2500;
const AUTOSAVE_DEBOUNCE_MS = 800;
/** show the re-entry ribbon after this long away */
const RIBBON_GAP_MS = 4 * 60 * 60 * 1000;
const READER_ACTIVITY_EVENT = "lectorium-reader-activity";

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

type Drawer = null | "toc" | "search" | "annotations";

export function Reader() {
  const bookId = useNavigation((s) => s.openBookId);
  const requestedLocatorJson = useNavigation((s) => s.openLocatorJson);
  const closeBook = useNavigation((s) => s.closeBook);
  const { settings, updateSettings } = useLibrary();
  const quietNight = useQuietNight(settings.bedtime);
  const effectiveTheme: ThemeName = quietNight ? "ember" : settings.theme;

  const [book, setBook] = useState<BookDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [ribbon, setRibbon] = useState<{ title: string; section: string | null } | null>(null);
  const [sectionTitle, setSectionTitle] = useState<string | null>(null);
  const fontDelta = settings.fontDelta;
  const setFontDelta = useCallback(
    (next: (current: number) => number) => {
      const current = useLibrary.getState().settings.fontDelta;
      const value = Math.max(-8, Math.min(12, next(current)));
      if (value !== current) void updateSettings({ fontDelta: value });
    },
    [updateSettings],
  );
  const [selection, setSelection] = useState<EngineSelection | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ selection: EngineSelection; keep: boolean } | null>(
    null,
  );
  const [studyPrompt, setStudyPrompt] = useState<string | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [footnote, setFootnote] = useState<{ text: string; rect: DOMRect } | null>(null);
  const [pdfView, setPdfView] = useState<"original" | "reflow">("original");
  const [reflowWarning, setReflowWarning] = useState<string | null>(null);
  const [reflowConfirmation, setReflowConfirmation] = useState(false);
  const [definePopover, setDefinePopover] = useState<{
    result: DefineResult;
    word: string;
    context: string;
    selection: EngineSelection;
    rect: { x: number; y: number };
    kept: boolean;
  } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [fullscreenNote, setFullscreenNote] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [externalUrl, setExternalUrl] = useState<string | null>(null);
  const [bookAnnotations, setBookAnnotations] = useState<ann.Annotation[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ReaderEngine | null>(null);
  const saveTimer = useRef<number | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveFailed = useRef(false);
  /** most recent locator — survives flushes so bookmarks/prompts anchor */
  const lastLocator = useRef<{ locator: LocatorEnvelope; context: LocatorContext } | null>(null);
  const saveDirty = useRef(false);
  const chromeTimer = useRef<number | null>(null);
  const annotationsRef = useRef<ann.Annotation[]>([]);
  const lastSection = useRef<string | null>(null);
  const modeRef = useRef<ReadingMode>("story");
  const fullscreenTransition = useRef<Promise<boolean> | null>(null);

  const [calibrating, setCalibrating] = useState(false);

  const setReaderFullscreen = useCallback(async (next?: boolean): Promise<boolean> => {
    const active = fullscreenTransition.current;
    // Some embedded-webview key paths can report the same physical key twice.
    // A duplicate toggle joins the active transition instead of reversing it.
    if (active && next === undefined) return active;
    if (active) await active;

    const transition = (async () => {
      try {
        if (lib.inTauri()) {
          const appWindow = getCurrentWindow();
          const current = await appWindow.isFullscreen();
          const desired = next ?? !current;
          if (current !== desired) await appWindow.setFullscreen(desired);
          setIsFullscreen(desired);
        } else {
          const current = Boolean(document.fullscreenElement);
          const desired = next ?? !current;
          if (desired && !current) await document.documentElement.requestFullscreen();
          if (!desired && current) await document.exitFullscreen();
          setIsFullscreen(desired);
        }
        setFullscreenNote(null);
        return true;
      } catch {
        setFullscreenNote("Full screen isn't available in this window.");
        return false;
      }
    })();
    fullscreenTransition.current = transition;
    try {
      return await transition;
    } finally {
      if (fullscreenTransition.current === transition) fullscreenTransition.current = null;
    }
  }, []);

  const typography: TypographySettings = useMemo(() => {
    const base = presets[settings.typographyPreset];
    const fontSizePx = Math.min(
      FONT_SIZE_MAX,
      Math.max(FONT_SIZE_MIN, base.fontSizePx + fontDelta),
    );
    return { ...base, fontSizePx, fontFamily: settings.calibratedFont ?? base.fontFamily };
  }, [settings.typographyPreset, fontDelta, settings.calibratedFont]);

  const flushSave = useCallback(async (): Promise<boolean> => {
    if (!bookId) return true;
    if (!saveDirty.current || !lastLocator.current) {
      await saveQueue.current;
      return !saveFailed.current;
    }
    saveDirty.current = false;
    const snapshot = lastLocator.current;
    const targetBookId = bookId;
    const { locator, context } = snapshot;
    const write = saveQueue.current.then(() =>
      lib.saveLocation(targetBookId, {
        engineType: locator.engine,
        locatorJson: serializeEnvelope(locator),
        sectionTitle: context.sectionTitle,
        pageIndex: context.pageIndex,
      }),
    );
    // A failed write must not poison later saves in the serialized queue.
    saveQueue.current = write.catch(() => undefined);
    try {
      await write;
      saveFailed.current = false;
      setSaveNote(null);
      return true;
    } catch {
      saveFailed.current = true;
      if (lastLocator.current === snapshot) saveDirty.current = true;
      setSaveNote("Reading place not saved yet. Lectorium will try again.");
      return false;
    }
  }, [bookId]);

  const leaveReader = useCallback(async () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (!(await flushSave())) return;
    await setReaderFullscreen(false);
    closeBook();
  }, [closeBook, flushSave, setReaderFullscreen]);

  const onLocatorChanged = useCallback(
    (locator: LocatorEnvelope, context: LocatorContext) => {
      lastLocator.current = { locator, context };
      saveDirty.current = true;
      setSectionTitle(context.sectionTitle);
      setProgress(typeof locator.coarse.progress === "number" ? locator.coarse.progress : null);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flushSave(), AUTOSAVE_DEBOUNCE_MS);

      // Study mode: one quiet optional prompt at a section boundary.
      const prev = lastSection.current;
      lastSection.current = context.sectionTitle;
      if (
        modeRef.current === "study" &&
        prev !== null &&
        context.sectionTitle !== null &&
        prev !== context.sectionTitle
      ) {
        setStudyPrompt(prev);
      }
    },
    [flushSave],
  );

  const refreshHighlights = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setHighlights(
      annotationsRef.current
        .filter((a) => a.kind === "highlight" || a.kind === "quote")
        .map((a) => ({
          id: a.id,
          locator: parseEnvelope(a.startLocatorJson),
          colorToken: a.colorToken ?? "selection",
        }))
        .filter((a): a is { id: string; locator: LocatorEnvelope; colorToken: string } =>
          Boolean(a.locator),
        ),
    );
  }, []);

  // open the book
  useEffect(() => {
    if (!bookId || !containerRef.current) return;
    let disposed = false;
    const container = containerRef.current;
    setEngineReady(false);
    lastLocator.current = null;
    saveDirty.current = false;
    saveFailed.current = false;

    void (async () => {
      try {
        const detail = await lib.getBook(bookId);
        if (disposed) return;
        setBook(detail);
        modeRef.current = detail.readingMode;

        const lastOpened = detail.lastOpenedAt ? Date.parse(detail.lastOpenedAt) : null;
        if (lastOpened && Date.now() - lastOpened > RIBBON_GAP_MS && detail.location) {
          setRibbon({ title: detail.title, section: detail.location.sectionTitle });
        }

        const engine = await makeEngine(detail.readingFormat);
        if (disposed) return;
        engineRef.current = engine;
        engine.onSelection((sel) => {
          setSelection(sel);
        });
        engine.onFootnote?.((note) => setFootnote(note));
        engine.onWheel?.((deltaY) => wheelFlipRef.current(deltaY));
        engine.onKeyDown?.((input) => {
          const event = new KeyboardEvent("keydown", {
            ...input,
            bubbles: true,
            cancelable: true,
          });
          return !window.dispatchEvent(event);
        });
        engine.onActivity?.(() => window.dispatchEvent(new Event(READER_ACTIVITY_EVENT)));
        engine.onExternalLink?.((url) => {
          try {
            const parsed = new URL(url);
            if (parsed.protocol === "http:" || parsed.protocol === "https:") {
              setExternalUrl(parsed.toString());
            }
          } catch {
            // malformed publication links stay inert
          }
        });
        await engine.open({
          container,
          book: detail,
          fileUrl: lib.bookFileUrl(detail.id),
          typography,
          theme: effectiveTheme,
          publisherStyles: settings.epubPublisherStyles,
          pdf: { colors: settings.pdfColors, fit: settings.pdfFit },
          onLocatorChanged,
        });
        if (disposed) {
          engine.destroy();
          return;
        }
        const requested = requestedLocatorJson ? parseEnvelope(requestedLocatorJson) : null;
        const saved =
          requested ?? (detail.location ? parseEnvelope(detail.location.locatorJson) : null);
        await engine.display(saved);
        await lib.markOpened(detail.id);
        annotationsRef.current = await ann.listAnnotations(detail.id);
        setBookAnnotations(annotationsRef.current);
        refreshHighlights();
        if (!disposed) setEngineReady(true);
      } catch (e) {
        console.error("[reader]", e);
        if (!disposed) {
          setError("Lectorium could not read this file. Your original was not changed.");
        }
      }
    })();

    return () => {
      disposed = true;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      void flushSave();
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
    engineRef.current?.applyTheme(effectiveTheme);
  }, [effectiveTheme]);
  useEffect(() => {
    engineRef.current?.applyPublisherStyles?.(settings.epubPublisherStyles);
  }, [settings.epubPublisherStyles]);
  useEffect(() => {
    engineRef.current?.applyPdfPresentation?.({
      colors: settings.pdfColors,
      fit: settings.pdfFit,
    });
  }, [settings.pdfColors, settings.pdfFit]);

  // flush the save on blur / hide / close
  useEffect(() => {
    const flush = () => void flushSave();
    window.addEventListener("blur", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("blur", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [flushSave]);

  // Tauri can wait for the durable SQLite write before destroying the window.
  // Browser lifecycle events cannot provide this guarantee on their own.
  useEffect(() => {
    if (!lib.inTauri()) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    let closing = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (closing) return;
        event.preventDefault();
        closing = true;
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        const saved = await flushSave();
        if (saved) {
          await getCurrentWindow().destroy();
        } else {
          closing = false;
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [flushSave]);

  // Keep the control label synchronized when the operating system changes
  // the native fullscreen state. Browser mode remains useful for web QA.
  useEffect(() => {
    if (!lib.inTauri()) {
      const syncBrowserState = () => setIsFullscreen(Boolean(document.fullscreenElement));
      syncBrowserState();
      document.addEventListener("fullscreenchange", syncBrowserState);
      return () => document.removeEventListener("fullscreenchange", syncBrowserState);
    }

    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const syncNativeState = () => {
      void appWindow.isFullscreen().then((value) => {
        if (!disposed) setIsFullscreen(value);
      });
    };
    syncNativeState();
    void appWindow.onResized(syncNativeState).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // chrome fade
  const wakeChrome = useCallback(() => {
    setChromeVisible(true);
    if (chromeTimer.current) window.clearTimeout(chromeTimer.current);
    chromeTimer.current = window.setTimeout(() => setChromeVisible(false), CHROME_FADE_MS);
  }, []);
  useEffect(() => {
    wakeChrome();
    window.addEventListener(READER_ACTIVITY_EVENT, wakeChrome);
    return () => {
      if (chromeTimer.current) window.clearTimeout(chromeTimer.current);
      window.removeEventListener(READER_ACTIVITY_EVENT, wakeChrome);
    };
  }, [wakeChrome]);

  const dismissRibbon = useCallback(() => setRibbon(null), []);

  const turn = useCallback(
    (dir: 1 | -1) => {
      dismissRibbon();
      const engine = engineRef.current;
      if (!engine) return;
      void (dir === 1 ? engine.next() : engine.prev()).then(refreshHighlights);
    },
    [dismissRibbon, refreshHighlights],
  );

  // Wheel-to-flip. One wheel gesture = one page turn (trackpads emit many
  // small deltas), so we throttle with a short cooldown. In PDF Reflow the
  // page genuinely scrolls, so wheel-flip is disabled there.
  const lastFlip = useRef(0);
  const wheelFlip = useCallback(
    (deltaY: number) => {
      if (pdfView === "reflow") return;
      if (Math.abs(deltaY) < 4) return;
      // a fit-width PDF page scrolls first and turns only at its edge
      if (engineRef.current?.consumesWheel?.(deltaY)) return;
      const now = Date.now();
      if (now - lastFlip.current < 380) return;
      lastFlip.current = now;
      turn(deltaY > 0 ? 1 : -1);
    },
    [turn, pdfView],
  );
  // The EPUB engine forwards iframe wheel events; keep it pointed at the
  // latest handler without re-opening the book.
  const wheelFlipRef = useRef(wheelFlip);
  useEffect(() => {
    wheelFlipRef.current = wheelFlip;
  }, [wheelFlip]);

  // ---- annotation actions ----

  const createAnnotation = useCallback(
    async (
      sel: EngineSelection,
      kind: ann.AnnotationKind,
      note: string | null,
      heading: string | null,
    ) => {
      if (!bookId) return;
      const record: ann.Annotation = {
        id: crypto.randomUUID(),
        bookId,
        kind,
        startLocatorJson: serializeEnvelope(sel.locator),
        endLocatorJson: null,
        exactQuote: sel.text,
        prefix: sel.locator.textQuote?.prefix ?? null,
        suffix: sel.locator.textQuote?.suffix ?? null,
        note,
        colorToken: "selection",
        commonplaceHeading: heading,
      };
      await ann.addAnnotation(record);
      annotationsRef.current = [...annotationsRef.current, record];
      setBookAnnotations(annotationsRef.current);
      refreshHighlights();
    },
    [bookId, refreshHighlights],
  );

  const onHighlight = useCallback(() => {
    if (selection) {
      void createAnnotation(selection, "highlight", null, null);
      setSelection(null);
    }
  }, [selection, createAnnotation]);

  const onCopy = useCallback(() => {
    if (selection) {
      void navigator.clipboard.writeText(selection.text);
      setSelection(null);
    }
  }, [selection]);

  const addBookmark = useCallback(() => {
    if (!bookId || !lastLocator.current) return;
    const { locator, context } = lastLocator.current;
    const record: ann.Annotation = {
      id: crypto.randomUUID(),
      bookId,
      kind: "bookmark",
      startLocatorJson: serializeEnvelope(locator),
      endLocatorJson: null,
      exactQuote: null,
      prefix: null,
      suffix: null,
      note: context.sectionTitle,
      colorToken: null,
      commonplaceHeading: null,
    };
    void ann.addAnnotation(record).then(() => {
      annotationsRef.current = [...annotationsRef.current, record];
      setBookAnnotations(annotationsRef.current);
    });
  }, [bookId]);

  const goToTarget = useCallback(
    (target: string) => {
      setDrawer(null);
      void engineRef.current?.goTo(target).then(refreshHighlights);
    },
    [refreshHighlights],
  );

  const switchPdfView = useCallback((mode: "original" | "reflow") => {
    const engine = engineRef.current;
    if (!engine?.setViewMode) return;
    void (async () => {
      if (mode === "reflow" && engine.getReflow) {
        const result = await engine.getReflow();
        if (result?.textUnavailable) {
          setReflowWarning("This PDF has no extractable text — Reflow isn't available.");
          return;
        }
        if (result?.truncated) {
          setReflowConfirmation(false);
          setReflowWarning(
            result.reason ??
              "Reflow could not safely analyze the complete PDF. Original view remains active.",
          );
          return;
        }
        if (result?.confidence === "low") {
          setReflowWarning(result.reason ?? "Reading order may be imperfect in Reflow.");
          setReflowConfirmation(true);
          return;
        }
        setReflowWarning(null);
        setReflowConfirmation(false);
      } else {
        setReflowWarning(null);
        setReflowConfirmation(false);
      }
      await engine.setViewMode?.(mode);
      setPdfView(mode);
    })();
  }, []);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      wakeChrome();
      if (e.ctrlKey && (e.key === "f" || e.key === "F")) {
        setDrawer((d) => (d === "search" ? null : "search"));
        e.preventDefault();
        return;
      }
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
        case "F11":
        case "f":
        case "F":
          if (!e.altKey && !e.metaKey) {
            void setReaderFullscreen();
            e.preventDefault();
          }
          break;
        case "a":
        case "A":
          setSheetOpen((v) => !v);
          break;
        case "t":
        case "T":
          setDrawer((d) => (d === "toc" ? null : "toc"));
          break;
        case "s":
        case "S":
          setDrawer((d) => (d === "search" ? null : "search"));
          break;
        case "b":
        case "B":
          addBookmark();
          break;
        case "n":
        case "N":
          if (selection) setNoteDraft({ selection, keep: false });
          break;
        case "Escape":
          if (noteDraft) setNoteDraft(null);
          else if (drawer) setDrawer(null);
          else if (sheetOpen) setSheetOpen(false);
          else if (studyPrompt) setStudyPrompt(null);
          else if (isFullscreen) void setReaderFullscreen(false);
          // Esc never closes the book
          break;
        case "+":
        case "=":
          if (e.ctrlKey) {
            setFontDelta((d) => d + 1);
            e.preventDefault();
          }
          break;
        case "-":
          if (e.ctrlKey) {
            setFontDelta((d) => d - 1);
            e.preventDefault();
          }
          break;
        case "0":
          if (e.ctrlKey) {
            setFontDelta(() => 0);
            e.preventDefault();
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    turn,
    sheetOpen,
    drawer,
    noteDraft,
    studyPrompt,
    selection,
    wakeChrome,
    addBookmark,
    isFullscreen,
    setReaderFullscreen,
    setFontDelta,
  ]);

  if (!bookId) {
    return (
      <main className="reader reader-empty" aria-label="Reader">
        <p>No book is open.</p>
        <button onClick={() => void leaveReader()}>Back to the room</button>
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
        <button onClick={() => void leaveReader()}>← Room</button>
        <span className="reader-chrome-title">
          {book?.title}
          {sectionTitle ? ` — ${sectionTitle}` : ""}
        </span>
        <button onClick={() => setDrawer((d) => (d === "toc" ? null : "toc"))}>Contents</button>
        <button onClick={() => setDrawer((d) => (d === "search" ? null : "search"))}>Search</button>
        <button onClick={() => setDrawer((d) => (d === "annotations" ? null : "annotations"))}>
          Marks
        </button>
        <button
          onClick={() => void setReaderFullscreen()}
          aria-pressed={isFullscreen}
          aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
        >
          {isFullscreen ? "Exit full screen" : "Full screen"}
        </button>
        <button onClick={() => setSheetOpen((v) => !v)} aria-label="Appearance">
          Aa
        </button>
      </header>

      {(saveNote || fullscreenNote) && (
        <p className="reader-save-note" role="status">
          {saveNote ?? fullscreenNote}
        </p>
      )}

      {externalUrl && (
        <aside className="external-link-sheet" role="dialog" aria-modal="true">
          <h2>Open an external link?</h2>
          <p>This leaves Lectorium and opens your system browser.</p>
          <p className="external-link-address">{externalUrl}</p>
          <div>
            <button onClick={() => setExternalUrl(null)}>Stay here</button>
            <button
              onClick={() => {
                const url = externalUrl;
                setExternalUrl(null);
                void openUrl(url);
              }}
            >
              Open link
            </button>
          </div>
        </aside>
      )}

      {error ? (
        <div className="reader-error" role="alert">
          <p>{error}</p>
          <button onClick={() => void leaveReader()}>Back to the room</button>
        </div>
      ) : (
        <div className="reader-stage" onWheel={(e) => wheelFlip(e.deltaY)}>
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

      {selection && !noteDraft && (
        <SelectionToolbar
          selection={selection}
          onHighlight={onHighlight}
          onNote={() => setNoteDraft({ selection, keep: false })}
          onDefine={() => {
            const word = dictionaryTermFromSelection(selection.text);
            const quote = selection.locator.textQuote;
            const context =
              selection.context ||
              dictionaryContext(
                quote?.prefix ?? "",
                quote?.exact ?? selection.text,
                quote?.suffix ?? "",
              );
            const rect = { x: selection.rect.x, y: selection.rect.y };
            const captured = selection;
            void define(word, context).then((result) =>
              setDefinePopover({ result, word, context, rect, selection: captured, kept: false }),
            );
          }}
          onKeep={() => setNoteDraft({ selection, keep: true })}
          onCopy={onCopy}
          onDismiss={() => setSelection(null)}
        />
      )}

      {footnote && (
        <aside
          className="footnote-popover"
          role="dialog"
          aria-label="Footnote"
          style={{
            top: Math.min(footnote.rect.y + 24, window.innerHeight - 180),
            left: Math.min(Math.max(16, footnote.rect.x - 140), window.innerWidth - 360),
          }}
        >
          <p>{footnote.text}</p>
          <button onClick={() => setFootnote(null)} aria-label="Close footnote">
            ×
          </button>
        </aside>
      )}

      {definePopover && (
        <aside
          className="footnote-popover define-popover"
          role="dialog"
          aria-label={`Definition of ${definePopover.word}`}
          style={{
            top: Math.min(definePopover.rect.y + 28, window.innerHeight - 180),
            left: Math.min(Math.max(16, definePopover.rect.x - 140), window.innerWidth - 360),
          }}
        >
          {definePopover.result.definition ? (
            <>
              <p className="define-word">
                {definePopover.result.definition.word}
                <span className="define-meta">
                  {definePopover.result.definition.headword !==
                    definePopover.result.definition.word &&
                    ` · ${definePopover.result.definition.headword}`}
                  {definePopover.result.definition.partOfSpeech &&
                    ` · ${definePopover.result.definition.partOfSpeech}`}
                </span>
                {definePopover.result.definition.pronunciation && (
                  <span className="define-pron">
                    {" "}
                    {definePopover.result.definition.pronunciation}
                  </span>
                )}
              </p>
              <p>{definePopover.result.definition.sense}</p>
            </>
          ) : (
            <p>{definePopover.result.message}</p>
          )}
          <button
            className="define-keep"
            disabled={definePopover.kept}
            onClick={() => {
              if (!bookId) return;
              void addVocabulary({
                id: crypto.randomUUID(),
                bookId,
                normalizedWord: normalizeDictionaryTerm(definePopover.word),
                displayedWord: definePopover.word,
                sentence: definePopover.context || definePopover.selection.text,
                definition: definePopover.result.definition?.sense ?? null,
                locatorJson: serializeEnvelope(definePopover.selection.locator),
                note: null,
              });
              setDefinePopover({ ...definePopover, kept: true });
            }}
          >
            {definePopover.kept ? "Kept" : "Keep word"}
          </button>
          <button onClick={() => setDefinePopover(null)} aria-label="Close definition">
            ×
          </button>
        </aside>
      )}

      {noteDraft && (
        <NoteSheet
          keep={noteDraft.keep}
          quote={noteDraft.selection.text}
          onSave={(note, heading) => {
            void createAnnotation(
              noteDraft.selection,
              noteDraft.keep ? "quote" : "note",
              note || null,
              heading || null,
            );
            setNoteDraft(null);
            setSelection(null);
          }}
          onCancel={() => setNoteDraft(null)}
        />
      )}

      {studyPrompt && (
        <StudyPrompt
          section={studyPrompt}
          onSave={(text) => {
            if (bookId && text.trim() && lastLocator.current) {
              const record: ann.Annotation = {
                id: crypto.randomUUID(),
                bookId,
                kind: "idea",
                startLocatorJson: serializeEnvelope(lastLocator.current.locator),
                endLocatorJson: null,
                exactQuote: null,
                prefix: null,
                suffix: null,
                note: text.trim(),
                colorToken: null,
                commonplaceHeading: studyPrompt,
              };
              void ann.addAnnotation(record).then(() => {
                annotationsRef.current = [...annotationsRef.current, record];
                setBookAnnotations(annotationsRef.current);
              });
            }
            setStudyPrompt(null);
          }}
          onDismiss={() => setStudyPrompt(null)}
        />
      )}

      {engineReady && engineRef.current && (
        <ForeEdge engine={engineRef.current} progress={progress} onNavigate={goToTarget} />
      )}

      <ReadingProgress progress={progress} />

      {drawer === "toc" && engineReady && engineRef.current && (
        <TocDrawer
          engine={engineRef.current}
          currentSection={sectionTitle}
          onNavigate={goToTarget}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer === "search" && engineReady && engineRef.current && (
        <SearchPanel
          engine={engineRef.current}
          onNavigate={goToTarget}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer === "annotations" && (
        <AnnotationsDrawer
          annotations={bookAnnotations}
          onNavigate={(locator) => {
            setDrawer(null);
            void engineRef.current?.display(locator).then(refreshHighlights);
          }}
          onDelete={(id) => {
            void ann.deleteAnnotation(id).then(() => {
              annotationsRef.current = annotationsRef.current.filter((item) => item.id !== id);
              setBookAnnotations(annotationsRef.current);
              refreshHighlights();
            });
          }}
          onClose={() => setDrawer(null)}
        />
      )}

      {reflowWarning && (
        <div className="reflow-warning" role="status">
          <span>{reflowWarning}</span>
          {reflowConfirmation && (
            <button
              onClick={() => {
                setReflowConfirmation(false);
                setReflowWarning(null);
                void engineRef.current?.setViewMode?.("reflow").then(() => setPdfView("reflow"));
              }}
            >
              Preview reflow
            </button>
          )}
          <button
            onClick={() => {
              setReflowWarning(null);
              setReflowConfirmation(false);
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {sheetOpen && book && (
        <AppearanceSheet
          theme={settings.theme}
          preset={settings.typographyPreset}
          mode={book.readingMode}
          isPdf={book.readingFormat === "pdf"}
          pdfView={pdfView}
          isEpub={book.readingFormat === "epub"}
          publisherStyles={settings.epubPublisherStyles}
          onTheme={(theme) => {
            applyTheme(quietNight ? "ember" : theme);
            void updateSettings({ theme });
          }}
          onPreset={(typographyPreset) => void updateSettings({ typographyPreset })}
          onPublisherStyles={(epubPublisherStyles) => void updateSettings({ epubPublisherStyles })}
          onMode={(mode) => {
            modeRef.current = mode;
            setBook({ ...book, readingMode: mode });
            void ann.setReadingMode(book.id, mode);
          }}
          onPdfView={switchPdfView}
          calibratedLabel={settings.calibratedFontLabel}
          onCalibrate={() => {
            setSheetOpen(false);
            setCalibrating(true);
          }}
          onClearCalibration={() =>
            void updateSettings({ calibratedFont: null, calibratedFontLabel: null })
          }
          onClose={() => setSheetOpen(false)}
        />
      )}

      {calibrating && (
        <Calibration
          onSkip={() => setCalibrating(false)}
          onDone={(label, stack) => {
            setCalibrating(false);
            void updateSettings({ calibratedFont: stack, calibratedFontLabel: label });
          }}
        />
      )}
    </main>
  );
}

function NoteSheet({
  keep,
  quote,
  onSave,
  onCancel,
}: {
  keep: boolean;
  quote: string;
  onSave: (note: string, heading: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const [heading, setHeading] = useState("");
  return (
    <aside className="note-sheet" role="dialog" aria-label={keep ? "Keep to Commonplace" : "Note"}>
      <blockquote>
        {takeGraphemes(quote, 240)}
        {graphemes(quote).length > 240 ? "…" : ""}
      </blockquote>
      <textarea
        autoFocus
        placeholder={keep ? "Why keep this? (optional)" : "Your note (optional)"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
      />
      {keep && (
        <input
          type="text"
          placeholder="Heading — e.g. courage, craft, history (optional)"
          value={heading}
          onChange={(e) => setHeading(e.target.value)}
          aria-label="Commonplace heading"
        />
      )}
      <div className="note-sheet-actions">
        <button className="note-sheet-save" onClick={() => onSave(note, heading)}>
          {keep ? "Keep" : "Save note"}
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </aside>
  );
}

/** One quiet optional field at a chapter boundary. Skippable, unscored. */
function StudyPrompt({
  section,
  onSave,
  onDismiss,
}: {
  section: string;
  onSave: (text: string) => void;
  onDismiss: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <aside className="study-prompt" role="dialog" aria-label="Reflection">
      <p className="study-prompt-section">{section}</p>
      <input
        type="text"
        placeholder="What stayed with you? (optional)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(text);
        }}
      />
      <div className="note-sheet-actions">
        <button onClick={() => onSave(text)}>Keep</button>
        <button onClick={onDismiss}>Not now</button>
      </div>
    </aside>
  );
}

function AppearanceSheet({
  theme,
  preset,
  mode,
  isPdf,
  pdfView,
  isEpub,
  publisherStyles,
  calibratedLabel,
  onTheme,
  onPreset,
  onMode,
  onPdfView,
  onPublisherStyles,
  onCalibrate,
  onClearCalibration,
  onClose,
}: {
  theme: ThemeName;
  preset: PresetName;
  mode: ReadingMode;
  isPdf: boolean;
  pdfView: "original" | "reflow";
  isEpub: boolean;
  publisherStyles: boolean;
  calibratedLabel: string | null;
  onTheme: (t: ThemeName) => void;
  onPreset: (p: PresetName) => void;
  onMode: (m: ReadingMode) => void;
  onPdfView: (v: "original" | "reflow") => void;
  onPublisherStyles: (enabled: boolean) => void;
  onCalibrate: () => void;
  onClearCalibration: () => void;
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
      {isPdf && (
        <div className="appearance-row" role="group" aria-label="PDF view">
          <span>View</span>
          <div>
            <button
              className={pdfView === "original" ? "is-active" : ""}
              onClick={() => onPdfView("original")}
            >
              Original
            </button>
            <button
              className={pdfView === "reflow" ? "is-active" : ""}
              onClick={() => onPdfView("reflow")}
            >
              Reflow
            </button>
          </div>
        </div>
      )}
      {isEpub && (
        <div className="appearance-row" role="group" aria-label="EPUB style">
          <span>EPUB style</span>
          <div>
            <button
              className={!publisherStyles ? "is-active" : ""}
              onClick={() => onPublisherStyles(false)}
            >
              Reader
            </button>
            <button
              className={publisherStyles ? "is-active" : ""}
              onClick={() => onPublisherStyles(true)}
              disabled={theme === "ember"}
              title={theme === "ember" ? "Publisher style is available with Paper" : undefined}
            >
              Publisher
            </button>
          </div>
        </div>
      )}
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
      <div className="appearance-row" role="group" aria-label="Reading mode">
        <span>Mode</span>
        <div>
          {(["story", "study", "contemplative"] as ReadingMode[]).map((m) => (
            <button key={m} className={mode === m ? "is-active" : ""} onClick={() => onMode(m)}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="appearance-calibrate">
        <button onClick={onCalibrate}>Make the page fit me</button>
        {calibratedLabel && (
          <span>
            {calibratedLabel} ·{" "}
            <button className="appearance-link" onClick={onClearCalibration}>
              reset
            </button>
          </span>
        )}
      </div>
      <p className="appearance-hint">
        F or F11 full screen · T contents · Ctrl+F search · B bookmark · Ctrl± text size · Esc
        closes
      </p>
      <button className="appearance-close" onClick={onClose} aria-label="Close appearance">
        ×
      </button>
    </aside>
  );
}
