import { useEffect } from "react";
import { applyTheme } from "../config/tokens";
import { useNavigation } from "../state/navigation";
import { Room } from "../spaces/room/Room";
import { Reader } from "../spaces/reader/Reader";
import { Stacks } from "../spaces/stacks/Stacks";
import { Commonplace } from "../spaces/commonplace/Commonplace";
import "./app.css";

export function App() {
  const space = useNavigation((s) => s.space);

  useEffect(() => {
    // Ember until stored settings load (M1); its values match the CSS
    // fallbacks in base.css so no bright frame can appear at startup.
    applyTheme("ember");
  }, []);

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
