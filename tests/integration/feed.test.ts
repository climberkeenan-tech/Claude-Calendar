import { beforeEach, describe, expect, it } from "vitest";
import ICAL from "ical.js";
import { db } from "@/lib/db/client";
import { events, occurrences } from "@/lib/db/schema";
import { getFeedRows } from "@/lib/db/queries/feed";
import { buildFeed } from "@/lib/ics/feed";
import { renderCalendar } from "@/lib/ics/serialize";
import { at, resetDb, seedUser, TZ, type Seeded } from "./setup";

/**
 * The whole subscription path, end to end: real rows -> the real query -> the
 * real builder -> a real ICS parser. Every layer here has been unit-tested in
 * isolation, and every defect the feed has had lived in the SEAM between them
 * — an UNTIL the query stored in one encoding and the builder emitted in
 * another, a VTIMEZONE that only covered part of the year.
 */

let me: Seeded;

beforeEach(async () => {
  await resetDb();
  me = await seedUser();
});

async function feedFor(now: Date): Promise<string> {
  const { events: rows, occurrencesByEvent } = await getFeedRows(me.userId, now);
  return renderCalendar(
    buildFeed({
      events: rows,
      occurrencesByEvent,
      domain: "hpu.example.app",
      calendarName: "High Point OS",
      now,
    }),
  );
}

/** Parse a feed, registering its VTIMEZONEs, and expand one series. */
function expand(ics: string, uidStartsWith: string, limit = 200) {
  const comp = new ICAL.Component(ICAL.parse(ics));
  for (const vt of comp.getAllSubcomponents("vtimezone")) {
    ICAL.TimezoneService.register(new ICAL.Timezone(vt));
  }
  const vevent = comp
    .getAllSubcomponents("vevent")
    .find((v) => String(v.getFirstPropertyValue("uid")).startsWith(uidStartsWith));
  if (!vevent) return null;
  const iter = new ICAL.Event(vevent).iterator();
  const out: ICAL.Time[] = [];
  let next;
  while ((next = iter.next()) && out.length < limit) out.push(next);
  return out;
}

describe("the calendar feed a subscriber actually receives", () => {
  it("is a parseable VCALENDAR even with nothing in it", async () => {
    const ics = await feedFor(at("2026-09-15", "12:00"));
    expect(() => ICAL.parse(ics)).not.toThrow();
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("gives a bounded weekly class every one of its meetings", async () => {
    // The two defects that used to bite here at once: the app stores UNTIL in
    // its floating fake-UTC encoding (so the last class was cut), and the
    // VTIMEZONE was anchored to the current year (so a January class resolved
    // five hours off). A spring class exercises both.
    const id = crypto.randomUUID();
    await db.insert(events).values({
      id,
      userId: me.userId,
      title: "BIO 110",
      kind: "event",
      tz: TZ,
      startsAt: at("2026-01-20", "09:00"),
      endsAt: at("2026-01-20", "10:00"),
      rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20260505T090000Z",
    });

    const ics = await feedFor(at("2026-02-01", "12:00"));
    const times = expand(ics, id)!;
    expect(times.length).toBeGreaterThan(0);

    // First meeting: 9 AM Eastern in JANUARY is 14:00Z. Getting 09:00Z back
    // means no observance covered the date.
    expect(times[0].toJSDate().toISOString()).toBe("2026-01-20T14:00:00.000Z");
    // Last meeting is the 5th of May — the bound must include it, not stop the
    // week before.
    expect(times.at(-1)!.toString()).toBe("2026-05-05T09:00:00");
    // And after March's transition the same wall clock is 13:00Z, which is the
    // entire point of shipping TZID instead of UTC.
    const march = times.find((t) => t.toString().startsWith("2026-03-10"));
    expect(march?.toJSDate().toISOString()).toBe("2026-03-10T13:00:00.000Z");
  });

  it("excludes a cancelled occurrence from an all-day series", async () => {
    const id = crypto.randomUUID();
    await db.insert(events).values({
      id,
      userId: me.userId,
      title: "Reading day",
      kind: "event",
      tz: TZ,
      allDay: true,
      startsAt: at("2026-09-07", "00:00"),
      endsAt: at("2026-09-08", "00:00"),
      rrule: "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261005T000000Z",
    });
    await db
      .insert(occurrences)
      .values({ eventId: id, occurrenceDate: "2026-09-21", cancelled: true });

    const ics = await feedFor(at("2026-09-08", "12:00"));
    // Value types must match the VALUE=DATE master, and an all-day-only feed
    // defines no VTIMEZONE for a TZID to point at.
    expect(ics).toContain("EXDATE;VALUE=DATE:20260921");
    expect(ics).not.toContain("BEGIN:VTIMEZONE");

    const days = expand(ics, id)!.map((t) => t.toString());
    expect(days).toContain("2026-09-14");
    expect(days).not.toContain("2026-09-21");
    expect(days).toContain("2026-09-28");
  });

  it("puts a task on its due date as an all-day banner", async () => {
    await db.insert(events).values({
      id: crypto.randomUUID(),
      userId: me.userId,
      title: "Essay",
      kind: "task",
      tz: TZ,
      dueAt: at("2026-09-18", "23:59"),
    });
    const ics = await feedFor(at("2026-09-15", "12:00"));
    expect(ics).toContain("DTSTART;VALUE=DATE:20260918");
    expect(ics).toContain("DTEND;VALUE=DATE:20260919"); // exclusive
    expect(ics).toContain("SUMMARY:Due: Essay");
  });

  it("never emits one user's events into another's feed", async () => {
    const other = await seedUser("other@example.com");
    await db.insert(events).values({
      id: crypto.randomUUID(),
      userId: other.userId,
      title: "Someone else's exam",
      kind: "event",
      tz: TZ,
      startsAt: at("2026-09-16", "09:00"),
      endsAt: at("2026-09-16", "10:00"),
    });
    const ics = await feedFor(at("2026-09-15", "12:00"));
    expect(ics).not.toContain("Someone else's exam");
  });
});
