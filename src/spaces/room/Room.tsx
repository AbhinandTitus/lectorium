import { useEffect, useState } from "react";
import { identity } from "../../config/identity";
import { useNavigation } from "../../state/navigation";
import { fetchAppStatus, type AppStatus } from "../../services/appStatus";
import "./room.css";

/**
 * M0 placeholder for the Room: calm static entry with the desk metaphor.
 * M1 replaces this with the real static room (current book + companions);
 * M4 layers the restrained 3D scene behind the same actions.
 */
export function Room() {
  const goTo = useNavigation((s) => s.goTo);
  const [status, setStatus] = useState<AppStatus | null>(null);

  useEffect(() => {
    void fetchAppStatus().then(setStatus);
  }, []);

  return (
    <main className="room" aria-label={identity.name}>
      <div className="room-desk">
        <p className="room-tagline">{identity.tagline}</p>
        <button className="room-primary" onClick={() => goTo("stacks")}>
          Place one book here
        </button>
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
