import { useEffect, useState } from "react";
import { applyTheme } from "../config/tokens";
import { inTauri } from "../services/library";
import { useLibrary } from "../state/library";
import { useNavigation } from "../state/navigation";
import { Onboarding } from "./Onboarding";
import { Room } from "../spaces/room/Room";
import { Reader } from "../spaces/reader/Reader";
import { Stacks } from "../spaces/stacks/Stacks";
import { Commonplace } from "../spaces/commonplace/Commonplace";
import "./app.css";

export function App() {
  const space = useNavigation((s) => s.space);
  const { settings, bootstrap } = useLibrary();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Ember is painted before this runs (base.css fallbacks), so startup
    // can never flash bright regardless of stored settings.
    void bootstrap().then(() => setReady(true));
  }, [bootstrap]);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  if (!ready) {
    // quiet dark surface while settings load; no spinner, no flash
    return <main className="app-loading" aria-label="Starting" />;
  }

  if (!settings.onboarded && inTauri()) {
    return <Onboarding />;
  }

  switch (space) {
    case "room":
      return <Room />;
    case "reader":
      return <Reader />;
    case "stacks":
      return <Stacks />;
    case "commonplace":
      return <Commonplace />;
  }
}
