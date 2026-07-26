/**
 * App rows → iCalendar components. Pure: it takes plain data and returns the
 * component tree, so the whole mapping is unit-testable without a database.
 *
 * Shape decisions, and why:
 *
 * - **Recurring series pass their RRULE through** rather than being expanded
 *   into hundreds of VEVENTs. The subscriber's calendar then owns expansion,
 *   the feed stays small, and "every Monday" keeps meaning every Monday
 *   instead of decaying into a fixed list that runs out.
 * - **Cancelled occurrences become EXDATE**; edited ones become a second
 *   VEVENT carrying the same UID and a RECURRENCE-ID. That's the RFC's own
 *   mechanism and exactly what the app's three edit modes already model.
 * - **Tasks become all-day VEVENTs on their due date**, not VTODOs: Google
 *   Calendar ignores VTODO outright, and an all-day banner is the one thing
 *   you cannot scroll past. Completed tasks are dropped — a met deadline is
 *   not an upcoming deadline.
 * - **Timed events use TZID, never UTC.** See vtimezone.ts.
 */
import { toFloating } from "@/lib/tz";
import { isoDay } from "@/lib/time";
import {
  formatDateOnly,
  formatLocal,
  formatUtc,
  type IcsComponent,
  type IcsProperty,
} from "./serialize";
import { buildVtimezone } from "./vtimezone";

export type FeedEvent = {
  id: string;
  title: string;
  kind: "event" | "task" | "habit";
  description: string | null;
  location: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  dueAt: Date | null;
  allDay: boolean;
  rrule: string | null;
  tz: string;
  categoryName: string | null;
  courseName: string | null;
  status: "scheduled" | "completed" | "cancelled";
  updatedAt: Date;
};

export type FeedOccurrence = {
  eventId: string;
  occurrenceDate: string; // YYYY-MM-DD in the event's tz
  cancelled: boolean;
  completed: boolean;
  overrides: {
    startsAt?: string;
    endsAt?: string;
    title?: string;
    location?: string;
  } | null;
};

/** Stable per-install UID suffix so two feeds never collide in one calendar. */
export function uidFor(eventId: string, domain: string, occurrence?: string): string {
  return occurrence
    ? `${eventId}-${occurrence.replace(/-/g, "")}@${domain}`
    : `${eventId}@${domain}`;
}

/** "BIO 110 · Classes" — the context a subscribed calendar otherwise loses. */
function describe(e: FeedEvent): string | null {
  const bits = [e.description?.trim(), e.courseName, e.categoryName].filter(
    (b): b is string => Boolean(b && b.length),
  );
  return bits.length ? bits.join("\n") : null;
}

function timedProps(name: "DTSTART" | "DTEND", at: Date, tz: string): IcsProperty {
  return {
    name,
    params: { TZID: tz },
    value: formatLocal(toFloating(at, tz)),
    escape: false,
  };
}

function dateProps(name: "DTSTART" | "DTEND", isoDate: string): IcsProperty {
  return {
    name,
    params: { VALUE: "DATE" },
    value: formatDateOnly(isoDate),
    escape: false,
  };
}

/** The day after `iso` — DTEND on an all-day VEVENT is exclusive. */
function nextDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Exclusive DTEND date for an all-day VEVENT. */
function allDayEnd(e: FeedEvent, startDay: string): string {
  if (!e.endsAt) return nextDay(startDay);
  const wall = toFloating(e.endsAt, e.tz);
  const atMidnight =
    wall.getUTCHours() === 0 && wall.getUTCMinutes() === 0 && wall.getUTCSeconds() === 0;
  const endDay = isoDay(e.endsAt, e.tz);
  const exclusive = atMidnight ? endDay : nextDay(endDay);
  // Never emit a zero-or-negative span: some clients drop the event entirely.
  return exclusive > startDay ? exclusive : nextDay(startDay);
}

function common(e: FeedEvent, uid: string, now: Date): IcsProperty[] {
  const props: IcsProperty[] = [
    { name: "UID", value: uid },
    { name: "DTSTAMP", value: formatUtc(now), escape: false },
    { name: "SUMMARY", value: e.title },
  ];
  const desc = describe(e);
  if (desc) props.push({ name: "DESCRIPTION", value: desc });
  if (e.location) props.push({ name: "LOCATION", value: e.location });
  props.push({
    name: "LAST-MODIFIED",
    value: formatUtc(e.updatedAt),
    escape: false,
  });
  // A completed class still happened; it just shouldn't nag.
  if (e.status === "completed") {
    props.push({ name: "STATUS", value: "CONFIRMED", escape: false });
    props.push({ name: "TRANSP", value: "TRANSPARENT", escape: false });
  }
  return props;
}

/** A dated task → an all-day banner on its due date. */
function taskComponent(e: FeedEvent, domain: string, now: Date): IcsComponent | null {
  if (!e.dueAt || e.status !== "scheduled") return null;
  const day = isoDay(e.dueAt, e.tz);
  const wall = toFloating(e.dueAt, e.tz);
  const endOfDay = wall.getUTCHours() === 23 && wall.getUTCMinutes() >= 59;
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: e.tz,
  }).format(e.dueAt);

  const props = common(
    { ...e, title: endOfDay ? `Due: ${e.title}` : `Due ${time}: ${e.title}` },
    uidFor(e.id, domain),
    now,
  );
  props.push(dateProps("DTSTART", day));
  props.push(dateProps("DTEND", nextDay(day)));
  // Deadlines shouldn't make the day look busy.
  props.push({ name: "TRANSP", value: "TRANSPARENT", escape: false });
  return { name: "VEVENT", props };
}

/** An event or habit → one VEVENT, plus one per edited occurrence. */
function timedComponents(
  e: FeedEvent,
  occurrences: FeedOccurrence[],
  domain: string,
  now: Date,
): IcsComponent[] {
  if (!e.startsAt || e.status === "cancelled") return [];
  const uid = uidFor(e.id, domain);
  const props = common(e, uid, now);

  if (e.allDay) {
    const day = isoDay(e.startsAt, e.tz);
    props.push(dateProps("DTSTART", day));
    // DTEND is EXCLUSIVE. The app already stores all-day ends as the NEXT
    // local midnight, so that value is used as-is — adding a day here would
    // stretch every all-day event across two days in the subscriber's
    // calendar. Anything not landing on midnight is treated as an inclusive
    // last day and pushed out by one.
    props.push(dateProps("DTEND", allDayEnd(e, day)));
  } else {
    props.push(timedProps("DTSTART", e.startsAt, e.tz));
    props.push(
      timedProps("DTEND", e.endsAt ?? new Date(e.startsAt.getTime() + 30 * 60000), e.tz),
    );
  }

  const out: IcsComponent[] = [];
  if (e.rrule) {
    props.push({ name: "RRULE", value: e.rrule, escape: false });

    const cancelled = occurrences.filter((o) => o.cancelled);
    if (cancelled.length > 0) {
      // One EXDATE property per excluded slot, at the SERIES time of day —
      // a bare date would be ignored by anything that expects a date-time.
      const wall = toFloating(e.startsAt, e.tz);
      const hhmmss = formatLocal(wall).slice(9);
      props.push({
        name: "EXDATE",
        params: { TZID: e.tz },
        value: cancelled
          .map((o) => `${formatDateOnly(o.occurrenceDate)}T${hhmmss}`)
          .join(","),
        escape: false,
      });
    }

    for (const o of occurrences) {
      if (o.cancelled || !o.overrides) continue;
      const start = o.overrides.startsAt ? new Date(o.overrides.startsAt) : null;
      const end = o.overrides.endsAt ? new Date(o.overrides.endsAt) : null;
      if (!start) continue;
      const wall = toFloating(e.startsAt, e.tz);
      const hhmmss = formatLocal(wall).slice(9);
      const override: IcsProperty[] = common(
        { ...e, title: o.overrides.title ?? e.title, location: o.overrides.location ?? e.location },
        uid,
        now,
      );
      override.push({
        name: "RECURRENCE-ID",
        params: { TZID: e.tz },
        value: `${formatDateOnly(o.occurrenceDate)}T${hhmmss}`,
        escape: false,
      });
      override.push(timedProps("DTSTART", start, e.tz));
      override.push(
        timedProps("DTEND", end ?? new Date(start.getTime() + 30 * 60000), e.tz),
      );
      out.push({ name: "VEVENT", props: override });
    }
  }

  out.unshift({ name: "VEVENT", props });
  return out;
}

export type FeedInput = {
  events: FeedEvent[];
  occurrencesByEvent: Map<string, FeedOccurrence[]>;
  /** Host used for UIDs — keeps two installs from colliding in one calendar. */
  domain: string;
  calendarName: string;
  now: Date;
};

export function buildFeed(input: FeedInput): IcsComponent {
  const { events, occurrencesByEvent, domain, calendarName, now } = input;

  const body: IcsComponent[] = [];
  const zones = new Set<string>();

  for (const e of events) {
    if (e.kind === "task") {
      const c = taskComponent(e, domain, now);
      if (c) body.push(c);
      continue;
    }
    const comps = timedComponents(e, occurrencesByEvent.get(e.id) ?? [], domain, now);
    if (comps.length > 0 && !e.allDay) zones.add(e.tz);
    body.push(...comps);
  }

  const year = now.getUTCFullYear();
  const vtimezones = [...zones].sort().map((tz) => buildVtimezone(tz, year));

  return {
    name: "VCALENDAR",
    props: [
      { name: "VERSION", value: "2.0", escape: false },
      { name: "PRODID", value: "-//High Point Productivity OS//EN" },
      { name: "CALSCALE", value: "GREGORIAN", escape: false },
      { name: "METHOD", value: "PUBLISH", escape: false },
      { name: "X-WR-CALNAME", value: calendarName },
      { name: "X-WR-TIMEZONE", value: [...zones][0] ?? "America/New_York" },
      // Apple and Google both honour this as a polling hint; without it some
      // clients settle on a 24-hour refresh and a reschedule takes a day to
      // show up on the phone.
      { name: "REFRESH-INTERVAL", params: { VALUE: "DURATION" }, value: "PT1H", escape: false },
      { name: "X-PUBLISHED-TTL", value: "PT1H", escape: false },
    ],
    children: [...vtimezones, ...body],
  };
}
