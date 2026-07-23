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

/** Start/end of the local day (in tz) as UTC instants. */
export function dayBounds(now: Date, tz: string = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(now); // YYYY-MM-DD
  const offsetAt = (iso: string) => {
    // Find the UTC instant corresponding to local midnight by probing the offset.
    const guess = new Date(`${iso}T00:00:00Z`);
    const local = new Date(
      guess.toLocaleString("en-US", { timeZone: tz }),
    ).getTime();
    const drift = guess.getTime() - (local - 0);
    return new Date(`${iso}T00:00:00Z`).getTime() + drift;
  };
  const start = new Date(offsetAt(parts));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, isoDay: parts };
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
  const ms = due.getTime() - now.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (ms < 0) return "overdue";
  if (days === 0) return `today ${fmtTime(due, tz)}`;
  if (days === 1) return `tomorrow ${fmtTime(due, tz)}`;
  if (days < 7) return fmtShortDay(due, tz);
  return fmtShortDay(due, tz);
}
