import { describe, expect, it } from "vitest";
import { isQuietNight } from "./quietNight";

function at(h: number, m: number): Date {
  const d = new Date(2026, 0, 1, h, m, 0);
  return d;
}

describe("isQuietNight", () => {
  it("is off when no bedtime is set", () => {
    expect(isQuietNight(null, at(23, 30))).toBe(false);
  });

  it("starts one hour before bedtime", () => {
    // bedtime 23:00 → window from 22:00
    expect(isQuietNight("23:00", at(21, 59))).toBe(false);
    expect(isQuietNight("23:00", at(22, 5))).toBe(true);
    expect(isQuietNight("23:00", at(23, 30))).toBe(true);
  });

  it("continues through the night past bedtime", () => {
    expect(isQuietNight("23:00", at(1, 0))).toBe(true); // 1am, within +3h
    expect(isQuietNight("23:00", at(3, 30))).toBe(false); // past the window
  });

  it("handles a post-midnight bedtime window wrap", () => {
    // bedtime 00:30 → window from 23:30
    expect(isQuietNight("00:30", at(23, 45))).toBe(true);
    expect(isQuietNight("00:30", at(0, 15))).toBe(true);
    expect(isQuietNight("00:30", at(22, 0))).toBe(false);
  });

  it("is off during the day", () => {
    expect(isQuietNight("23:00", at(14, 0))).toBe(false);
  });
});
