import { useEffect, useState } from "react";
import { applyTheme } from "../config/tokens";
import { inTauri } from "../services/library";
import { useLibrary } from "../state/library";
import { useNavigation } from "../state/navigation";
import { ErrorBoundary } from "./ErrorBoundary";
import { Onboarding } from "./Onboarding";
import { Room } from "../spaces/room/Room";
import { Reader } from "../spaces/reader/Reader";
import { Stacks } from "../spaces/stacks/Stacks";
import { Commonplace } from "../spaces/commonplace/Commonplace";
import { useQuietNight } from "../config/useQuietNight";
import "./app.css";

export function App() {
  const space = useNavigation((s) => s.space);
  const goTo = useNavigation((s) => s.goTo);
  const { settings, bootstrap } = useLibrary();
  const [ready, setReady] = useState(false);
  const quietNight = useQuietNight(settings.bedtime);

  useEffect(() => {
    // Ember is painted before this runs (base.css fallbacks), so startup
    // can never flash bright regardless of stored settings.
    void bootstrap().then(() => setReady(true));
  }, [bootstrap]);

  useEffect(() => {
    applyTheme(quietNight ? "ember" : settings.theme);
  }, [quietNight, settings.theme]);

  if (!ready) {
    // quiet dark surface while settings load; no spinner, no flash
    return <main className="app-loading" aria-label="Starting" />;
  }

  if (!settings.onboarded && inTauri()) {
    return <Onboarding />;
  }

  // A crash in any one space must never blank the whole app; the boundary is
  // keyed by space so navigating away clears a stuck error.
  return (
    <ErrorBoundary
      key={space}
      fallback={(retry) => (
        <main className="space-placeholder" aria-label="Something went wrong">
          <h1>Something went wrong on this screen.</h1>
          <p>Your books and notes are safe. You can go back to the room and try again.</p>
          <button
            onClick={() => {
              retry();
              goTo("room");
            }}
          >
            Back to the room
          </button>
        </main>
      )}
    >
      {space === "room" && <Room />}
      {space === "reader" && <Reader />}
      {space === "stacks" && <Stacks />}
      {space === "commonplace" && <Commonplace />}
    </ErrorBoundary>
  );
}
