import { fromFloating, toFloating } from "@/lib/tz";

const DEFAULT_TZ = "America/New_York";

export function fmtTime(d: Date, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(d);
}

export function fmtWeekday(d: Date, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: tz,
  }).format(d);
}

export function fmtShortDay(d: Date, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  }).format(d);
}

/** Start/end of the local day (in tz) as UTC instants — DST-exact: the "day"
 * runs midnight-to-midnight in tz, which is 23 h or 25 h on transition days,
 * so the end is computed from the NEXT day's midnight, never `start + 24 h`. */
export function dayBounds(now: Date, tz: string = DEFAULT_TZ) {
  const isoDay = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(now); // YYYY-MM-DD
  const nextIso = new Date(new Date(`${isoDay}T12:00:00Z`).getTime() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const start = fromFloating(new Date(`${isoDay}T00:00:00Z`), tz);
  const end = fromFloating(new Date(`${nextIso}T00:00:00Z`), tz);
  return { start, end, isoDay };
}

/** "in 40 min" / "in 3 h 20 min" / "now" */
export function untilLabel(from: Date, to: Date): string {
  const mins = Math.round((to.getTime() - from.getTime()) / 60000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `in ${h} h` : `in ${h} h ${m} min`;
}

/** "40 min left" for the NOW block. */
export function leftLabel(now: Date, end: Date): string {
  const mins = Math.round((end.getTime() - now.getTime()) / 60000);
  if (mins <= 0) return "wrapping up";
  if (mins < 60) return `${mins} min left`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h left` : `${h} h ${m} min left`;
}

export function relativeDue(now: Date, due: Date, tz: string = DEFAULT_TZ): string {
  if (due.getTime() < now.getTime()) return "overdue";
  // "today"/"tomorrow" are CALENDAR days in tz, not 24-hour buckets — a
  // deadline at 8 AM tomorrow seen at 11 PM tonight must not say "today".
  const dayIso = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  const nowIso = dayIso(now);
  const dueIso = dayIso(due);
  if (dueIso === nowIso) return `today ${fmtTime(due, tz)}`;
  // Tomorrow = the next CALENDAR day, derived from the date string (noon
  // anchor), never from now+24h — which lands on the wrong day around both
  // DST transitions (23 h and 25 h days).
  const tomorrowIso = new Date(
    new Date(`${nowIso}T12:00:00Z`).getTime() + 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);
  if (dueIso === tomorrowIso) return `tomorrow ${fmtTime(due, tz)}`;
  return fmtShortDay(due, tz);
}

// ---------------------------------------------------------------------------
// Profile-timezone primitives (Phase 10 consistency pass)
//
// Client views used to key dates off the BROWSER's timezone while the server
// used the profile timezone. Identical while you're in Eastern — silently
// wrong the moment you travel (an 11 PM Eastern class shows on the wrong day
// from California, and dragging it commits the wrong hour). Everything the
// calendar renders or writes now goes through these.
// ---------------------------------------------------------------------------

export const PROFILE_TZ = DEFAULT_TZ;

/** The "YYYY-MM-DD" an instant falls on, in the profile timezone. */
export function isoDay(d: Date, tz: string = PROFILE_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(d);
}

/** Minutes since midnight of the profile-timezone wall clock (0–1439). */
export function minutesOfDay(d: Date, tz: string = PROFILE_TZ): number {
  const f = toFloating(d, tz);
  return f.getUTCHours() * 60 + f.getUTCMinutes();
}

/** "HH:MM" in the profile timezone — for <input type="time"> values. */
export function timeValue(d: Date, tz: string = PROFILE_TZ): string {
  const m = minutesOfDay(d, tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(m / 60))}:${p(m % 60)}`;
}

/** Wall-clock "YYYY-MM-DDTHH:MM:SS" in the profile timezone — the shape the
 * server's draft schemas expect. */
export function wallClockValue(d: Date, tz: string = PROFILE_TZ): string {
  return `${isoDay(d, tz)}T${timeValue(d, tz)}:00`;
}

/** An instant from a profile-timezone wall clock, DST-correct. */
export function instantFromWallClock(
  dayIso: string,
  hhmm: string,
  tz: string = PROFILE_TZ,
): Date {
  return fromFloating(new Date(`${dayIso}T${hhmm}:00Z`), tz);
}

/** Parse a zone-less wall-clock string ("2026-09-14T19:00:00" — what Claude and
 * the draft schemas emit) as PROFILE time. Plain `new Date(s)` reads it in the
 * browser's zone, which silently shifts every AI-parsed item when travelling.
 * Returns null for anything that isn't a wall clock. */
export function instantFromWallClockIso(
  s: string,
  tz: string = PROFILE_TZ,
): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(:\d{2})?(Z|[+-]\d{2}:?\d{2})?$/.exec(
    s.trim(),
  );
  if (!m) return null;
  // An explicit offset means it isn't a wall clock at all — take it at its word.
  if (m[5]) {
    const d = new Date(s.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return instantFromWallClock(m[1], `${m[2]}:${m[3]}`, tz);
}

/** Shift an ISO date by whole calendar days (noon anchor — DST-proof). */
export function shiftDay(dayIso: string, days: number): string {
  const d = new Date(`${dayIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday=0 … Sunday=6 for an ISO date (no timezone involved). */
export function weekdayIndex(dayIso: string): number {
  return (new Date(`${dayIso}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** Day-of-month for an ISO date, as a number. */
export function dayOfMonth(dayIso: string): number {
  return Number(dayIso.slice(8, 10));
}

/** Format an ISO date (not an instant) — safe because the noon anchor can't
 * slip a day in any timezone. */
export function fmtIsoDay(
  dayIso: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(
    new Date(`${dayIso}T12:00:00Z`),
  );
}

/** "1 PM" for the time-grid's hour rail. Takes an hour number, not an instant —
 * the rail is wall-clock furniture, unrelated to any date. */
export function fmtHourLabel(hour: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, 0, 1, hour)));
}
