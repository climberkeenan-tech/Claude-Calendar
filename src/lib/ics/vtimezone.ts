/**
 * VTIMEZONE generation, derived from the runtime's own zone database rather
 * than a hardcoded table.
 *
 * Why bother instead of emitting everything in UTC: a recurring event anchored
 * in UTC drifts an hour across every DST change. A 9 AM class written as
 * 13:00Z shows up at 8 AM once the clocks go back — the exact bug this app
 * spent Phase 3 designing the floating-time convention to avoid. Recurring
 * events therefore use TZID, and TZID means the file must carry a VTIMEZONE
 * that Google, Apple, and Outlook all accept.
 */
import { toFloating } from "@/lib/tz";
import {
  formatLocal,
  formatOffset,
  type IcsComponent,
  type IcsProperty,
} from "./serialize";

/** Minutes east of UTC for `tz` at `instant` (New York in summer = -240). */
export function offsetMinutes(instant: Date, tz: string): number {
  return Math.round((toFloating(instant, tz).getTime() - instant.getTime()) / 60000);
}

/** Short zone name ("EST"/"EDT"), falling back to the numeric offset. */
function zoneAbbreviation(instant: Date, tz: string): string {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "short",
  })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName")?.value;
  if (part && /^[A-Za-z]+$/.test(part)) return part;
  return `GMT${formatOffset(offsetMinutes(instant, tz))}`;
}

export type Transition = {
  /** The instant the offset changes. */
  at: Date;
  offsetFrom: number;
  offsetTo: number;
  name: string;
};

const HOUR = 3600_000;

/**
 * Find every offset change in `year`, to the minute. Scans in six-hour steps
 * (no real zone changes offset twice within six hours) and then bisects.
 */
export function findTransitions(tz: string, year: number): Transition[] {
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const out: Transition[] = [];
  let prevAt = new Date(start);
  let prev = offsetMinutes(prevAt, tz);

  for (let t = start + 6 * HOUR; t <= end; t += 6 * HOUR) {
    const at = new Date(t);
    const off = offsetMinutes(at, tz);
    if (off === prev) {
      prevAt = at;
      prev = off;
      continue;
    }
    // Bisect the six-hour window down to the minute.
    let lo = prevAt.getTime();
    let hi = t;
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 2 / 60_000) * 60_000;
      if (mid === lo) break;
      if (offsetMinutes(new Date(mid), tz) === prev) lo = mid;
      else hi = mid;
    }
    const at2 = new Date(hi);
    out.push({ at: at2, offsetFrom: prev, offsetTo: off, name: zoneAbbreviation(at2, tz) });
    prevAt = at2;
    prev = off;
  }
  return out;
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * "second Sunday in March" → BYMONTH=3;BYDAY=2SU. Uses -1 for the last
 * occurrence, which is what "last Sunday in October" has to serialize as —
 * 5SU would simply not exist in most years.
 */
export function yearlyRule(wallClock: Date): string {
  const month = wallClock.getUTCMonth() + 1;
  const day = wallClock.getUTCDate();
  const dow = DAYS[wallClock.getUTCDay()];
  const nth = Math.floor((day - 1) / 7) + 1;
  const daysInMonth = new Date(
    Date.UTC(wallClock.getUTCFullYear(), wallClock.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const isLast = day + 7 > daysInMonth;
  return `FREQ=YEARLY;BYMONTH=${month};BYDAY=${isLast ? -1 : nth}${dow}`;
}

function observance(
  name: "STANDARD" | "DAYLIGHT",
  t: Transition,
  recurring: boolean,
): IcsComponent {
  // DTSTART in a VTIMEZONE is the LOCAL time of the change, expressed in the
  // offset that was in effect just before it.
  const localAtChange = new Date(t.at.getTime() + t.offsetFrom * 60000);
  // ...but anchored at 1970, not at the year we happened to scan. An
  // observance only takes effect from its DTSTART, so anchoring to the current
  // year leaves everything before that year's first transition with no
  // applicable observance at all — and clients fall back to UTC. A 9 AM class
  // on 20 January parsed back as 09:00Z instead of 14:00Z: five hours off, for
  // the whole first stretch of spring term. The yearly RRULE below is derived
  // from the REAL transition and carries the rule forward from 1970, which is
  // the shape Google's own feeds publish.
  const anchored = new Date(localAtChange);
  anchored.setUTCFullYear(1970);
  const props: IcsProperty[] = [
    { name: "DTSTART", value: formatLocal(anchored), escape: false },
    { name: "TZOFFSETFROM", value: formatOffset(t.offsetFrom), escape: false },
    { name: "TZOFFSETTO", value: formatOffset(t.offsetTo), escape: false },
    { name: "TZNAME", value: t.name },
  ];
  if (recurring) {
    props.splice(1, 0, {
      name: "RRULE",
      value: yearlyRule(localAtChange),
      escape: false,
    });
  }
  return { name, props };
}

/**
 * Build a VTIMEZONE for `tz`. `year` selects which year's transitions are
 * SCANNED to learn the rules; the observances themselves are anchored at 1970
 * and carried forward by yearly RRULEs, so the zone is defined for every date
 * a feed can contain rather than only for dates after `year`'s first
 * transition. Pass the current year to describe the rules now in force.
 *
 * A zone with no DST gets a single STANDARD observance and no RRULE. A zone
 * whose rules changed recently is described by the CURRENT rules, which is the
 * best a feed can do and what clients assume.
 */
export function buildVtimezone(tz: string, year: number): IcsComponent {
  const transitions = findTransitions(tz, year);

  if (transitions.length === 0) {
    const anchor = new Date(Date.UTC(year, 0, 1));
    const off = offsetMinutes(anchor, tz);
    return {
      name: "VTIMEZONE",
      props: [{ name: "TZID", value: tz }],
      children: [
        {
          name: "STANDARD",
          props: [
            // Same reasoning as observance(): a fixed-offset zone still needs
            // its single observance to predate every event in the feed.
            { name: "DTSTART", value: "19700101T000000", escape: false },
            { name: "TZOFFSETFROM", value: formatOffset(off), escape: false },
            { name: "TZOFFSETTO", value: formatOffset(off), escape: false },
            { name: "TZNAME", value: zoneAbbreviation(anchor, tz) },
          ],
        },
      ],
    };
  }

  // Two transitions a year is the normal case: one into DST, one out of it.
  // More than two (rare, e.g. a mid-year rule change) — take the last of each
  // direction, since those are the rules going forward.
  const toDst = transitions.filter((t) => t.offsetTo > t.offsetFrom).at(-1);
  const toStd = transitions.filter((t) => t.offsetTo < t.offsetFrom).at(-1);

  const children: IcsComponent[] = [];
  if (toStd) children.push(observance("STANDARD", toStd, true));
  if (toDst) children.push(observance("DAYLIGHT", toDst, true));
  // Southern-hemisphere zones only see one direction inside a calendar year;
  // synthesize the other from the offset that must be in force at year start.
  if (children.length === 1) {
    const only = toStd ?? toDst!;
    const opposite: Transition = {
      at: new Date(Date.UTC(year, 0, 1)),
      offsetFrom: only.offsetTo,
      offsetTo: only.offsetFrom,
      name: zoneAbbreviation(new Date(Date.UTC(year, 0, 1)), tz),
    };
    children.push(observance(toStd ? "DAYLIGHT" : "STANDARD", opposite, false));
  }

  return {
    name: "VTIMEZONE",
    props: [{ name: "TZID", value: tz }],
    children,
  };
}
