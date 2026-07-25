/**
 * Pure date math for "this and future" series splits. Lives here (not in the
 * "use server" file) so it can be unit-tested directly — this arithmetic
 * decides which class dates keep their cancellations, and getting it wrong
 * resurrects days the user cancelled.
 */

export function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`); // noon anchor: never trips DST
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Days between two ISO dates. This is the REAL calendar distance — the shift
 * a split applies to occurrence rows sitting on the moved weekday.
 *
 * It must NOT be a weekday difference wrapped into [-3,+3]: moving a Monday
 * series to Friday of the same week is +4 days, and wrapping made it −3,
 * dropping every cancellation and completion into the wrong week.
 */
export function isoDayDiff(fromIso: string, toIso: string): number {
  return Math.round(
    (new Date(`${toIso}T00:00:00Z`).getTime() -
      new Date(`${fromIso}T00:00:00Z`).getTime()) /
      86_400_000,
  );
}
