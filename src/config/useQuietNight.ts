import { useEffect, useState } from "react";
import { isQuietNight } from "./quietNight";

/** Re-evaluate the local bedtime window without requiring an app restart. */
export function useQuietNight(bedtime: string | null): boolean {
  const [, setClock] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return isQuietNight(bedtime);
}
