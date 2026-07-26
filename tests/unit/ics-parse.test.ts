import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import { buildFeed, type FeedEvent, type FeedOccurrence } from "@/lib/ics/feed";
import { renderCalendar } from "@/lib/ics/serialize";
import { instantFromWallClock } from "@/lib/time";

/**
 * The other ICS suite checks what we WRITE. This one checks that a strict
 * third-party parser — ical.js, the implementation behind Thunderbird — reads
 * it back with the right meaning. It's the closest thing to "does Google
 * accept this" that runs offline, and it's where a wrong VTIMEZONE shows up:
 * the file looks fine, and the recurring event lands an hour off after the
 * clocks change.
 */

const NOW = new Date("2026-09-14T12:00:00Z");

const ev = (over: Partial<FeedEvent> = {}): FeedEvent => ({
  id: "e1",
  title: "BIO 110 lecture",
  kind: "event",
  description: null,
  location: "Congdon 210",
  startsAt: instantFromWallClock("2026-09-14", "09:00"),
  endsAt: instantFromWallClock("2026-09-14", "09:50"),
  dueAt: null,
  allDay: false,
  rrule: null,
  tz: "America/New_York",
  categoryName: "Classes",
  courseName: "BIO 110",
  status: "scheduled",
  updatedAt: NOW,
  ...over,
});

function parse(events: FeedEvent[], occ: [string, FeedOccurrence[]][] = []) {
  const ics = renderCalendar(
    buildFeed({
      events,
      occurrencesByEvent: new Map(occ),
      domain: "hpu.example.app",
      calendarName: "High Point OS",
      now: NOW,
    }),
  );
  const comp = new ICAL.Component(ICAL.parse(ics));
  // Register the feed's own VTIMEZONE so TZID resolution uses OUR definition,
  // not the parser's built-in table — otherwise this test proves nothing.
  for (const vt of comp.getAllSubcomponents("vtimezone")) {
    const tz = new ICAL.Timezone(vt);
    ICAL.TimezoneService.register(tz);
  }
  return comp;
}

const vevents = (c: ICAL.Component) => c.getAllSubcomponents("vevent");

describe("a standards parser reads the feed back correctly", () => {
  it("parses at all — malformed folding or CRLF would throw here", () => {
    const c = parse([ev(), ev({ id: "e2", title: "CSC 121, lab; room B" })]);
    expect(c.name).toBe("vcalendar");
    expect(vevents(c)).toHaveLength(2);
    // Escaped separators come back as the original characters.
    const titles = vevents(c).map((v) => v.getFirstPropertyValue("summary"));
    expect(titles).toContain("CSC 121, lab; room B");
  });

  it("resolves a timed event to the right instant through our VTIMEZONE", () => {
    const c = parse([ev()]);
    const e = new ICAL.Event(vevents(c)[0]);
    expect(e.startDate.toJSDate().toISOString()).toBe(
      instantFromWallClock("2026-09-14", "09:00").toISOString(),
    );
    expect(e.endDate.toJSDate().toISOString()).toBe(
      instantFromWallClock("2026-09-14", "09:50").toISOString(),
    );
  });

  it("keeps a weekly class at 9 AM local ACROSS the DST change", () => {
    // The whole reason the feed uses TZID instead of UTC. Written as 13:00Z,
    // this class would show up at 8 AM once the clocks go back on Nov 1.
    const c = parse([ev({ rrule: "FREQ=WEEKLY;BYDAY=MO" })]);
    const e = new ICAL.Event(vevents(c)[0]);
    const it_ = e.iterator();
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      const next = it_.next();
      if (!next) break;
      seen.push(next.toJSDate().toISOString());
    }
    // Sep 14 is EDT (UTC-4) → 13:00Z. Nov 2 is EST (UTC-5) → 14:00Z.
    expect(seen[0]).toBe("2026-09-14T13:00:00.000Z");
    const nov = seen.find((s) => s.startsWith("2026-11-02"));
    expect(nov).toBe("2026-11-02T14:00:00.000Z");
    // Same wall clock throughout — that's the invariant.
    for (const s of seen) {
      const local = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/New_York",
      }).format(new Date(s));
      expect(local).toBe("09:00");
    }
  });

  it("honours EXDATE — a cancelled class is skipped, not shifted", () => {
    const c = parse(
      [ev({ rrule: "FREQ=WEEKLY;BYDAY=MO" })],
      [[
        "e1",
        [
          {
            eventId: "e1",
            occurrenceDate: "2026-09-21",
            cancelled: true,
            completed: false,
            overrides: null,
          },
        ],
      ]],
    );
    const e = new ICAL.Event(vevents(c)[0]);
    const it_ = e.iterator();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const next = it_.next();
      if (!next) break;
      seen.push(next.toJSDate().toISOString().slice(0, 10));
    }
    expect(seen).toContain("2026-09-14");
    expect(seen).not.toContain("2026-09-21"); // cancelled
    expect(seen).toContain("2026-09-28");
  });

  it("links an edited occurrence to its series via RECURRENCE-ID", () => {
    const c = parse(
      [ev({ rrule: "FREQ=WEEKLY;BYDAY=MO" })],
      [[
        "e1",
        [
          {
            eventId: "e1",
            occurrenceDate: "2026-09-21",
            cancelled: false,
            completed: false,
            overrides: {
              startsAt: instantFromWallClock("2026-09-21", "11:00").toISOString(),
              endsAt: instantFromWallClock("2026-09-21", "12:00").toISOString(),
              title: "BIO 110 — makeup",
            },
          },
        ],
      ]],
    );
    const all = vevents(c);
    expect(all).toHaveLength(2);

    const master = all.find((v) => !v.getFirstProperty("recurrence-id"))!;
    const exception = all.find((v) => v.getFirstProperty("recurrence-id"))!;
    expect(master.getFirstPropertyValue("uid")).toBe(
      exception.getFirstPropertyValue("uid"),
    );

    // The parser attaches the exception to the master and reports the new time.
    const event = new ICAL.Event(master);
    event.relateException(exception);
    const zone = ICAL.TimezoneService.get("America/New_York")!;
    const rid = new ICAL.Time(
      { year: 2026, month: 9, day: 21, hour: 9, minute: 0, second: 0 },
      zone,
    );
    const details = event.getOccurrenceDetails(rid);
    expect(details.item.summary).toBe("BIO 110 — makeup");
    expect(details.startDate.toJSDate().toISOString()).toBe(
      instantFromWallClock("2026-09-21", "11:00").toISOString(),
    );
  });

  it("reads a task as a one-day all-day banner", () => {
    const c = parse([
      ev({
        id: "t1",
        kind: "task",
        title: "Bio essay",
        startsAt: null,
        endsAt: null,
        location: null,
        dueAt: instantFromWallClock("2026-09-18", "23:59"),
      }),
    ]);
    const e = new ICAL.Event(vevents(c)[0]);
    expect(e.summary).toBe("Due: Bio essay");
    expect(e.startDate.isDate).toBe(true);
    expect(e.startDate.toString()).toBe("2026-09-18");
    expect(e.endDate.toString()).toBe("2026-09-19"); // exclusive → one day
    expect(e.duration.toSeconds()).toBe(86400);
  });

  it("a one-day all-day event is one day, not two", () => {
    const c = parse([
      ev({
        allDay: true,
        startsAt: instantFromWallClock("2026-09-14", "00:00"),
        endsAt: instantFromWallClock("2026-09-15", "00:00"),
      }),
    ]);
    const e = new ICAL.Event(vevents(c)[0]);
    expect(e.duration.toSeconds()).toBe(86400);
  });

  it("round-trips a title full of separators and multi-byte characters", () => {
    const nasty = "Étude 🎓, part 2; “notes\\refs” — 75+ chars of padding padding padding";
    const c = parse([ev({ title: nasty })]);
    expect(vevents(c)[0].getFirstPropertyValue("summary")).toBe(nasty);
  });

  it("carries the properties a subscribing client keys off", () => {
    const c = parse([ev()]);
    expect(c.getFirstPropertyValue("version")).toBe("2.0");
    expect(c.getFirstPropertyValue("prodid")).toContain("High Point");
    expect(c.getFirstPropertyValue("x-wr-calname")).toBe("High Point OS");
    const v = vevents(c)[0];
    expect(v.getFirstPropertyValue("uid")).toBe("e1@hpu.example.app");
    expect(v.getFirstPropertyValue("dtstamp")).toBeTruthy();
    expect(v.getFirstPropertyValue("location")).toBe("Congdon 210");
    expect(String(v.getFirstPropertyValue("description"))).toContain("BIO 110");
  });
});
