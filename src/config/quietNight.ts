/**
 * Quiet Night: the wind-down window before a chosen bedtime (docs/PRODUCT.md).
 * During it, decorative motion freezes, Ember is used, and Recall is deferred.
 * It never locks the reader out.
 */

/** Minutes before bedtime that Quiet Night begins. */
const WIND_DOWN_MINUTES = 60;

/** Is `now` within the wind-down window of `bedtime` ("HH:MM")? */
export function isQuietNight(bedtime: string | null, now = new Date()): boolean {
  if (!bedtime) return false;
  const m = /^(\d{1,2}):(\d{2})$/.exec(bedtime);
  if (!m) return false;
  const bedMinutes = Number(m[1]) * 60 + Number(m[2]);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const start = (bedMinutes - WIND_DOWN_MINUTES + 1440) % 1440;
  // window runs from start until a few hours past bedtime (through the night)
  const end = (bedMinutes + 180) % 1440;
  return inWindow(nowMinutes, start, end);
}

function inWindow(t: number, start: number, end: number): boolean {
  return start <= end ? t >= start && t < end : t >= start || t < end;
}
