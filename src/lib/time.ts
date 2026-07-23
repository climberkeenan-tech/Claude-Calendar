import { fromFloating } from "@/lib/tz";

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
