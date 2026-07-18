import { identity } from "../../config/identity";
import { useLibrary } from "../../state/library";
import { useNavigation } from "../../state/navigation";
import { BookCover } from "../../components/BookCover";
import "./room.css";

/**
 * The static Room (M1): one current book under the lamp, up to two
 * companions, one obvious action. The 3D scene arrives in M4 behind the
 * same actions. No counts, no charts, no library on this surface.
 */
export function Room() {
  const goTo = useNavigation((s) => s.goTo);
  const openBook = useNavigation((s) => s.openBook);
  const { status, desk } = useLibrary();

  const current = desk.find((b) => b.deskRole === "current") ?? desk[0] ?? null;
  const companions = desk.filter((b) => b !== current).slice(0, 2);

  return (
    <main className="room" aria-label={identity.name}>
      <div className="room-scene">
        <div className="room-desk-surface">
          {current ? (
            <div className="room-current">
              <button
                className="room-current-book"
                onClick={() => openBook(current.id)}
                aria-label={`Continue reading ${current.title}`}
              >
                <BookCover book={current} size="large" />
              </button>
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

          {companions.length > 0 && (
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

      <nav className="room-secondary" aria-label="Secondary">
        <button onClick={() => goTo("stacks")}>Stacks</button>
        <button onClick={() => goTo("commonplace")}>Commonplace</button>
      </nav>

      {status && (
        <p className="room-version" aria-hidden="true">
          {identity.name} {status.appVersion}
        </p>
      )}
    </main>
  );
}
