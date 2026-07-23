/**
 * Timezone conversion helpers — the floating-time convention (ARCHITECTURE §4).
 *
 * `rrule`'s native TZID support is known-buggy around DST, so all recurrence
 * math happens in "floating time": wall-clock values encoded as if they were
 * UTC. These two functions convert between real instants and floating time at
 * the boundary.
 */

/** Real instant → floating time (the wall clock in `tz`, encoded as UTC). */
export function toFloating(instant: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: tz,
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  // en-CA with hour12:false can yield hour "24" at midnight; normalize.
  const hour = get("hour") % 24;
  return new Date(
    Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second")),
  );
}

/** Floating time (wall clock encoded as UTC) → the real instant in `tz`. */
export function fromFloating(floating: Date, tz: string): Date {
  // First guess: treat the floating value as if tz were UTC, then correct by
  // the real offset at that moment (two passes to converge across DST edges).
  let guess = new Date(floating.getTime());
  for (let i = 0; i < 2; i++) {
    const seen = toFloating(guess, tz);
    const drift = floating.getTime() - seen.getTime();
    if (drift === 0) return guess;
    guess = new Date(guess.getTime() + drift);
  }
  return guess;
}

/** Convert a "YYYY-MM-DD" + "HH:MM" wall clock in tz to the real instant. */
export function wallClockToInstant(
  date: string,
  time: string,
  tz: string,
): Date {
  return fromFloating(new Date(`${date}T${time}:00Z`), tz);
}

/** The "YYYY-MM-DD" a real instant falls on in tz. */
export function isoDayInTz(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(instant);
}
