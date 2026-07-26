import { RRule } from "rrule";
import { fromFloating, isoDayInTz, toFloating } from "@/lib/tz";

/**
 * Recurrence expansion — pure functions, floating-time convention.
 *
 * A recurring event stores: startsAt/endsAt (first occurrence, real instants),
 * an RFC 5545 `rrule` string (no DTSTART — we supply it), and `tz`. Expansion:
 *   1. convert the series start to floating time (wall clock as fake-UTC),
 *   2. run rrule entirely in floating time,
 *   3. convert each occurrence back to a real instant with `fromFloating`.
 * This keeps "every Monday 5 PM" at 5 PM local across both DST transitions.
 */

export type SeriesEvent = {
  id: string;
  startsAt: Date;
  endsAt: Date | null;
  rrule: string | null;
  tz: string;
};

export type OccurrenceOverride = {
  occurrenceDate: string; // YYYY-MM-DD (in event tz)
  cancelled: boolean;
  completed: boolean;
  overrides: {
    startsAt?: string;
    endsAt?: string;
    title?: string;
    location?: string;
  } | null;
};

export type ExpandedOccurrence = {
  eventId: string;
  /** YYYY-MM-DD key of the original slot (stable across time overrides). */
  occurrenceDate: string;
  startsAt: Date;
  endsAt: Date | null;
  completed: boolean;
  overridden: boolean;
  titleOverride?: string;
  locationOverride?: string;
};

/** Parse an RRULE string in floating time with the series start as DTSTART. */
function buildRule(event: SeriesEvent): RRule {
  const dtstart = toFloating(event.startsAt, event.tz);
  const opts = RRule.parseString(event.rrule ?? "");
  return new RRule({ ...opts, dtstart });
}

/**
 * Expand one event's occurrences that intersect [windowStart, windowEnd).
 * Non-recurring events yield zero or one occurrence.
 */
/**
 * Does [start, end) reach into a window beginning at `windowStart`?
 *
 * `endsAt` is EXCLUSIVE everywhere in this codebase — an all-day event runs to
 * the NEXT local midnight — so `end >= windowStart` counted yesterday's all-day
 * event as part of today: its end IS today's midnight. Every UI surface
 * re-buckets by day and hid it, but MCP get_agenda reads this directly, so
 * asking Claude "what's on today" listed yesterday's holiday.
 *
 * The second clause is not redundant: an event with no `endsAt` has
 * `end === start`, so a zero-duration item sitting exactly on the window's
 * opening instant would fail `end > windowStart` and be dropped.
 */
function overlaps(start: Date, end: Date, windowStart: Date): boolean {
  return end > windowStart || start >= windowStart;
}

export function expandEvent(
  event: SeriesEvent,
  overrides: OccurrenceOverride[],
  windowStart: Date,
  windowEnd: Date,
): ExpandedOccurrence[] {
  const durationMs = event.endsAt
    ? event.endsAt.getTime() - event.startsAt.getTime()
    : 0;
  const byDate = new Map(overrides.map((o) => [o.occurrenceDate, o]));

  const emit = (start: Date): ExpandedOccurrence | null => {
    const key = isoDayInTz(start, event.tz);
    const o = byDate.get(key);
    if (o?.cancelled) return null;
    let s = start;
    let e = durationMs > 0 ? new Date(start.getTime() + durationMs) : null;
    if (o?.overrides?.startsAt) s = new Date(o.overrides.startsAt);
    if (o?.overrides?.endsAt) e = new Date(o.overrides.endsAt);
    return {
      eventId: event.id,
      occurrenceDate: key,
      startsAt: s,
      endsAt: e,
      completed: o?.completed ?? false,
      overridden: Boolean(o?.overrides),
      titleOverride: o?.overrides?.title,
      locationOverride: o?.overrides?.location,
    };
  };

  if (!event.rrule) {
    const end = event.endsAt ?? event.startsAt;
    if (event.startsAt < windowEnd && overlaps(event.startsAt, end, windowStart)) {
      const one = emit(event.startsAt);
      return one ? [one] : [];
    }
    return [];
  }

  const rule = buildRule(event);
  // Pad the floating window: a day each side for UTC-offset skew, plus the
  // event's own duration on the near side so an occurrence that *started*
  // before the window but is still running is not missed. Post-override
  // real-instant filtering below makes the result exact.
  const DAY = 24 * 60 * 60 * 1000;
  const floatStart = new Date(
    toFloating(windowStart, event.tz).getTime() - DAY - durationMs,
  );
  const floatEnd = new Date(toFloating(windowEnd, event.tz).getTime() + DAY);

  const inWindow = (occ: ExpandedOccurrence) => {
    const end = occ.endsAt ?? occ.startsAt;
    return occ.startsAt < windowEnd && overlaps(occ.startsAt, end, windowStart);
  };

  const out: ExpandedOccurrence[] = [];
  const emitted = new Set<string>();
  for (const f of rule.between(floatStart, floatEnd, true)) {
    const start = fromFloating(f, event.tz);
    const occ = emit(start);
    if (!occ) {
      emitted.add(isoDayInTz(start, event.tz)); // cancelled — still handled
      continue;
    }
    emitted.add(occ.occurrenceDate);
    // Filter on POST-override times: a moved occurrence belongs to the window
    // it was moved into, not the one it left.
    if (inWindow(occ)) out.push(occ);
  }
  // Time-overridden occurrences whose ORIGINAL slot fell outside the padded
  // expansion range can still have been moved into this window — emit them.
  for (const o of overrides) {
    if (o.cancelled || !o.overrides?.startsAt) continue;
    if (emitted.has(o.occurrenceDate)) continue;
    const s = new Date(o.overrides.startsAt);
    const e = o.overrides.endsAt
      ? new Date(o.overrides.endsAt)
      : durationMs > 0
        ? new Date(s.getTime() + durationMs)
        : null;
    const occ: ExpandedOccurrence = {
      eventId: event.id,
      occurrenceDate: o.occurrenceDate,
      startsAt: s,
      endsAt: e,
      completed: o.completed,
      overridden: true,
      titleOverride: o.overrides.title,
      locationOverride: o.overrides.location,
    };
    if (inWindow(occ)) out.push(occ);
  }
  out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return out;
}

/**
 * For a "this and future" split: the UNTIL value that keeps every occurrence
 * strictly before `splitStart`. Returned in floating time, formatted for an
 * RRULE string. Never bare UTC midnight — it's the instant of the last kept
 * occurrence's start (in floating encoding), which cannot drop a final day.
 */
export function untilBefore(
  event: SeriesEvent,
  splitStart: Date,
): string | null {
  const rule = buildRule(event);
  const floatSplit = toFloating(splitStart, event.tz);
  const prev = rule.before(new Date(floatSplit.getTime() - 1), true);
  if (!prev) return null; // nothing before the split — series should be deleted
  return prev
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/** Append/replace UNTIL in an rrule string. */
/**
 * The continuing half of a "this and future" split keeps the series' own
 * UNTIL — that bound is the end of term and still applies to it. Dropping it
 * turned a 29-meeting imported class into 193 the first time it was edited.
 *
 * The one exception: if the edit moved the occurrence PAST the old bound, an
 * unchanged UNTIL would leave the new series empty, silently eating the very
 * occurrence the user just moved. Then the bound extends to cover it, and no
 * further.
 */
export function carryUntil(rruleStr: string, newStart: Date, tz: string): string {
  const until = rruleStr
    .split(";")
    .find((p) => p.toUpperCase().startsWith("UNTIL="))
    ?.slice(6);
  if (!until) return rruleStr;
  const floatingStart = toFloating(newStart, tz)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return until >= floatingStart ? rruleStr : withUntil(rruleStr, floatingStart);
}

export function withUntil(rruleStr: string, untilFloating: string): string {
  const parts = rruleStr
    .split(";")
    .filter((p) => p && !p.toUpperCase().startsWith("UNTIL="));
  parts.push(`UNTIL=${untilFloating}`);
  return parts.join(";");
}
