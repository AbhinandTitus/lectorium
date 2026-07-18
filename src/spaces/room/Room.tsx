import { lazy, Suspense, useMemo, useState } from "react";
import { identity } from "../../config/identity";
import { useLibrary } from "../../state/library";
import { useNavigation } from "../../state/navigation";
import { BookCover } from "../../components/BookCover";
import { Settings } from "../../app/Settings";
import { ErrorBoundary } from "../../app/ErrorBoundary";
import { isQuietNight } from "../../config/quietNight";
import { webglAvailable } from "./Room3D";
import "./room.css";

// Three.js is heavy; never let it weigh down launch. Loaded only when the
// Room actually shows the 3D scene.
const Room3D = lazy(() => import("./Room3D").then((m) => ({ default: m.Room3D })));

/**
 * The Room: one current book under the lamp, up to two companions, one
 * obvious action. A restrained 3D scene (M4) renders behind the same actions
 * when WebGL is available and quality isn't "flat"; otherwise the static room
 * shows. The scene unmounts the moment a book opens (handled by the router).
 */
export function Room() {
  const goTo = useNavigation((s) => s.goTo);
  const openBook = useNavigation((s) => s.openBook);
  const { status, desk, settings } = useLibrary();

  const current = desk.find((b) => b.deskRole === "current") ?? desk[0] ?? null;
  const companions = desk.filter((b) => b !== current).slice(0, 2);

  const [webgl] = useState(webglAvailable);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // if the 3D scene ever errors, fall back to the static room for the session
  const [threeFailed, setThreeFailed] = useState(false);
  const use3D = webgl && settings.roomQuality !== "flat" && !threeFailed;

  // Quiet Night (bedtime wind-down) or reduced motion freezes decorative motion.
  const reducedMotion = useMemo(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const quietNight = reducedMotion || isQuietNight(settings.bedtime);

  return (
    <main className="room" aria-label={identity.name}>
      {use3D && (
        <ErrorBoundary onError={() => setThreeFailed(true)} fallback={() => null}>
          <Suspense fallback={null}>
            <Room3D
              current={current}
              companions={companions}
              quality={settings.roomQuality}
              quietNight={quietNight}
              onOpen={openBook}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Foreground UI: the actions live above the scene and are the
          keyboard-accessible equivalents of every 3D interaction. */}
      <div className={`room-ui${use3D ? " over-3d" : ""}`}>
        <div className="room-scene">
          <div className="room-desk-surface">
            {current ? (
              <div className="room-current">
                {!use3D && (
                  <button
                    className="room-current-book"
                    onClick={() => openBook(current.id)}
                    aria-label={`Continue reading ${current.title}`}
                  >
                    <BookCover book={current} size="large" />
                  </button>
                )}
                <p className="room-current-title" lang={current.language ?? undefined}>
                  {current.title}
                </p>
                <button className="room-primary" onClick={() => openBook(current.id)}>
                  Continue reading
                </button>
              </div>
            ) : (
              <div className="room-current">
                <p className="room-tagline">{identity.tagline}</p>
                <button className="room-primary" onClick={() => goTo("stacks")}>
                  Place one book here
                </button>
              </div>
            )}

            {!use3D && companions.length > 0 && (
              <div className="room-companions" aria-label="Companion books">
                {companions.map((b) => (
                  <button
                    key={b.id}
                    className="room-companion"
                    onClick={() => openBook(b.id)}
                    aria-label={`Open ${b.title}`}
                    title={b.title}
                  >
                    <BookCover book={b} size="medium" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {use3D && companions.length > 0 && (
          <nav className="room-companion-links" aria-label="Companion books">
            {companions.map((b) => (
              <button key={b.id} onClick={() => openBook(b.id)}>
                {b.title}
              </button>
            ))}
          </nav>
        )}

        <nav className="room-secondary" aria-label="Secondary">
          <button onClick={() => goTo("stacks")}>Stacks</button>
          <button onClick={() => goTo("commonplace")}>Commonplace</button>
          <button onClick={() => setSettingsOpen(true)}>Settings</button>
          {webgl && <RoomQualityMenu />}
        </nav>
      </div>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}

      {status && (
        <p className="room-version" aria-hidden="true">
          {identity.name} {status.appVersion}
        </p>
      )}
    </main>
  );
}

function RoomQualityMenu() {
  const { settings, updateSettings } = useLibrary();
  const [open, setOpen] = useState(false);
  const labels: Record<string, string> = { high: "Room: High", low: "Room: Low", flat: "Room: 2D" };
  return (
    <span className="room-quality">
      <button onClick={() => setOpen((v) => !v)}>{labels[settings.roomQuality]}</button>
      {open && (
        <span className="room-quality-menu" role="menu">
          {(["high", "low", "flat"] as const).map((q) => (
            <button
              key={q}
              role="menuitemradio"
              aria-checked={settings.roomQuality === q}
              onClick={() => {
                void updateSettings({ roomQuality: q });
                setOpen(false);
              }}
            >
              {q === "high" ? "High detail" : q === "low" ? "Low detail" : "2D (no 3D)"}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
