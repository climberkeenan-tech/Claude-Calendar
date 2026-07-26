import { describe, expect, it } from "vitest";
import {
  escapeText,
  foldLine,
  formatDateOnly,
  formatLocal,
  formatOffset,
  formatUtc,
  renderCalendar,
} from "@/lib/ics/serialize";
import { buildVtimezone, findTransitions, yearlyRule } from "@/lib/ics/vtimezone";
import { buildFeed, type FeedEvent, type FeedOccurrence } from "@/lib/ics/feed";
import { instantFromWallClock } from "@/lib/time";

const NOW = new Date("2026-09-14T12:00:00Z");

const ev = (over: Partial<FeedEvent> = {}): FeedEvent => ({
  id: "e1",
  title: "BIO 110 lecture",
  kind: "event",
  description: null,
  location: "Congdon 210",
  startsAt: instantFromWallClock("2026-09-14", "08:00"),
  endsAt: instantFromWallClock("2026-09-14", "08:50"),
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

const feed = (events: FeedEvent[], occ: [string, FeedOccurrence[]][] = []) =>
  renderCalendar(
    buildFeed({
      events,
      occurrencesByEvent: new Map(occ),
      domain: "hpu.example.app",
      calendarName: "High Point OS",
      now: NOW,
    }),
  );

/** Split a rendered calendar back into unfolded logical lines. */
const lines = (ics: string) =>
  ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);

describe("RFC 5545 serialization", () => {
  it("escapes the characters that silently corrupt a title", () => {
    // An unescaped comma splits a TEXT value into a list: the title arrives
    // truncated at the comma with no error anywhere.
    expect(escapeText("Lab, then dinner")).toBe("Lab\\, then dinner");
    expect(escapeText("CS;101")).toBe("CS\\;101");
    expect(escapeText("a\\b")).toBe("a\\\\b");
    expect(escapeText("line1\nline2")).toBe("line1\\nline2");
    expect(escapeText("line1\r\nline2")).toBe("line1\\nline2");
  });

  it("folds on OCTETS, never mid-character", () => {
    const long = "SUMMARY:" + "a".repeat(200);
    const folded = foldLine(long);
    for (const l of folded.split("\r\n")) {
      expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });

  it("folds multi-byte text without splitting a codepoint", () => {
    const long = "SUMMARY:" + "é🎓".repeat(40);
    const folded = foldLine(long);
    for (const l of folded.split("\r\n")) {
      expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    }
    const rejoined = folded.replace(/\r\n /g, "");
    expect(rejoined).toBe(long);
    expect(rejoined).not.toContain("�"); // no mangled codepoints
  });

  it("formats the three date/time shapes", () => {
    expect(formatUtc(new Date("2026-09-14T13:00:00Z"))).toBe("20260914T130000Z");
    expect(formatLocal(new Date(Date.UTC(2026, 8, 14, 8, 0, 0)))).toBe("20260914T080000");
    expect(formatDateOnly("2026-09-14")).toBe("20260914");
    expect(formatOffset(-300)).toBe("-0500");
    expect(formatOffset(-240)).toBe("-0400");
    expect(formatOffset(330)).toBe("+0530");
    expect(formatOffset(0)).toBe("+0000");
  });

  it("every line ends CRLF and the file ends with one", () => {
    const ics = feed([ev()]);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\n").every((l, i, a) => i === a.length - 1 || l.endsWith("\r"))).toBe(true);
  });
});

describe("VTIMEZONE from the runtime zone database", () => {
  it("finds both New York transitions in a year, to the minute", () => {
    const t = findTransitions("America/New_York", 2026);
    expect(t).toHaveLength(2);
    // 2 AM EST on the second Sunday in March = 07:00Z
    expect(t[0].at.toISOString()).toBe("2026-03-08T07:00:00.000Z");
    expect(t[0].offsetFrom).toBe(-300);
    expect(t[0].offsetTo).toBe(-240);
    // 2 AM EDT on the first Sunday in November = 06:00Z
    expect(t[1].at.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(t[1].offsetTo).toBe(-300);
  });

  it("derives the yearly rule, including 'last <day> of the month'", () => {
    expect(yearlyRule(new Date(Date.UTC(2026, 2, 8, 2)))).toBe(
      "FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    );
    expect(yearlyRule(new Date(Date.UTC(2026, 10, 1, 2)))).toBe(
      "FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    );
    // 25 Oct 2026 is the last Sunday in October — must be -1SU, not 4SU.
    expect(yearlyRule(new Date(Date.UTC(2026, 9, 25, 2)))).toBe(
      "FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    );
  });

  it("emits STANDARD and DAYLIGHT with the offsets a client needs", () => {
    const vt = renderCalendar(buildVtimezone("America/New_York", 2026));
    const l = lines(vt);
    expect(l).toContain("TZID:America/New_York");
    expect(l).toContain("TZOFFSETFROM:-0500");
    expect(l).toContain("TZOFFSETTO:-0400");
    expect(l).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU");
    expect(l).toContain("RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU");
    expect(l.filter((x) => x === "BEGIN:DAYLIGHT")).toHaveLength(1);
    expect(l.filter((x) => x === "BEGIN:STANDARD")).toHaveLength(1);
    // DTSTART is the LOCAL clock at the change, in the OLD offset.
    expect(l).toContain("DTSTART:20260308T020000");
  });

  it("a zone with no DST gets one observance and no RRULE", () => {
    const l = lines(renderCalendar(buildVtimezone("America/Phoenix", 2026)));
    expect(l.filter((x) => x.startsWith("RRULE"))).toHaveLength(0);
    expect(l).toContain("TZOFFSETTO:-0700");
  });

  it("handles a southern-hemisphere zone and a half-hour offset", () => {
    const auckland = lines(renderCalendar(buildVtimezone("Pacific/Auckland", 2026)));
    expect(auckland.filter((x) => x === "BEGIN:STANDARD")).toHaveLength(1);
    expect(auckland.filter((x) => x === "BEGIN:DAYLIGHT")).toHaveLength(1);
    const kolkata = lines(renderCalendar(buildVtimezone("Asia/Kolkata", 2026)));
    expect(kolkata).toContain("TZOFFSETTO:+0530");
  });
});

describe("feed contents", () => {
  it("a timed event carries TZID, not UTC — a UTC RRULE drifts across DST", () => {
    const l = lines(feed([ev({ rrule: "FREQ=WEEKLY;BYDAY=MO" })]));
    expect(l).toContain("DTSTART;TZID=America/New_York:20260914T080000");
    expect(l).toContain("DTEND;TZID=America/New_York:20260914T085000");
    expect(l).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(l.some((x) => x.startsWith("DTSTART") && x.endsWith("Z"))).toBe(false);
    expect(l).toContain("BEGIN:VTIMEZONE");
  });

  it("recurring series stay a series — never a wall of expanded VEVENTs", () => {
    const l = lines(feed([ev({ rrule: "FREQ=DAILY" })]));
    expect(l.filter((x) => x === "BEGIN:VEVENT")).toHaveLength(1);
  });

  it("cancelled occurrences become EXDATE at the series time of day", () => {
    const l = lines(
      feed(
        [ev({ rrule: "FREQ=WEEKLY;BYDAY=MO" })],
        [[
          "e1",
          [
            { eventId: "e1", occurrenceDate: "2026-09-21", cancelled: true, completed: false, overrides: null },
            { eventId: "e1", occurrenceDate: "2026-09-28", cancelled: true, completed: false, overrides: null },
          ],
        ]],
      ),
    );
    expect(l).toContain(
      "EXDATE;TZID=America/New_York:20260921T080000,20260928T080000",
    );
  });

  it("an edited occurrence becomes a second VEVENT with the same UID", () => {
    const l = lines(
      feed(
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
                startsAt: instantFromWallClock("2026-09-21", "10:00").toISOString(),
                endsAt: instantFromWallClock("2026-09-21", "11:00").toISOString(),
                title: "BIO 110 — makeup",
              },
            },
          ],
        ]],
      ),
    );
    expect(l.filter((x) => x === "BEGIN:VEVENT")).toHaveLength(2);
    expect(l.filter((x) => x === "UID:e1@hpu.example.app")).toHaveLength(2);
    expect(l).toContain("RECURRENCE-ID;TZID=America/New_York:20260921T080000");
    expect(l).toContain("DTSTART;TZID=America/New_York:20260921T100000");
    expect(l).toContain("SUMMARY:BIO 110 — makeup");
  });

  it("a dated task is an all-day banner with an exclusive DTEND", () => {
    const l = lines(
      feed([
        ev({
          id: "t1",
          kind: "task",
          title: "Bio essay",
          startsAt: null,
          endsAt: null,
          location: null,
          dueAt: instantFromWallClock("2026-09-18", "23:59"),
        }),
      ]),
    );
    expect(l).toContain("DTSTART;VALUE=DATE:20260918");
    expect(l).toContain("DTEND;VALUE=DATE:20260919"); // exclusive
    expect(l).toContain("SUMMARY:Due: Bio essay");
    expect(l).toContain("TRANSP:TRANSPARENT"); // a deadline isn't "busy"
  });

  it("a task due at a specific time says so in the title", () => {
    const l = lines(
      feed([
        ev({
          id: "t2",
          kind: "task",
          title: "Problem set",
          startsAt: null,
          endsAt: null,
          dueAt: instantFromWallClock("2026-09-18", "17:00"),
        }),
      ]),
    );
    expect(l).toContain("SUMMARY:Due 5:00 PM: Problem set");
  });

  it("a completed task drops out; a completed class stays but goes free", () => {
    const done = feed([
      ev({ id: "t3", kind: "task", startsAt: null, endsAt: null, dueAt: NOW, status: "completed" }),
    ]);
    expect(lines(done).filter((x) => x === "BEGIN:VEVENT")).toHaveLength(0);

    const attended = lines(feed([ev({ status: "completed" })]));
    expect(attended.filter((x) => x === "BEGIN:VEVENT")).toHaveLength(1);
    expect(attended).toContain("TRANSP:TRANSPARENT");
  });

  it("a one-day all-day event stays ONE day", () => {
    // The app stores all-day ends as the NEXT local midnight, i.e. already
    // exclusive. Adding a day here would show every all-day event as a
    // two-day banner in Google and Apple Calendar.
    const l = lines(
      feed([
        ev({
          allDay: true,
          startsAt: instantFromWallClock("2026-09-14", "00:00"),
          endsAt: instantFromWallClock("2026-09-15", "00:00"),
        }),
      ]),
    );
    expect(l).toContain("DTSTART;VALUE=DATE:20260914");
    expect(l).toContain("DTEND;VALUE=DATE:20260915");
  });

  it("a multi-day all-day event keeps its full span", () => {
    const l = lines(
      feed([
        ev({
          allDay: true,
          startsAt: instantFromWallClock("2026-09-14", "00:00"),
          endsAt: instantFromWallClock("2026-09-17", "00:00"),
        }),
      ]),
    );
    expect(l).toContain("DTSTART;VALUE=DATE:20260914");
    expect(l).toContain("DTEND;VALUE=DATE:20260917"); // 14, 15, 16
  });

  it("an all-day event with no end, or a same-day end, never collapses", () => {
    const noEnd = lines(
      feed([
        ev({
          allDay: true,
          startsAt: instantFromWallClock("2026-09-14", "00:00"),
          endsAt: null,
        }),
      ]),
    );
    expect(noEnd).toContain("DTEND;VALUE=DATE:20260915");
    // An inclusive same-day end (not midnight) gets pushed out by one.
    const inclusive = lines(
      feed([
        ev({
          allDay: true,
          startsAt: instantFromWallClock("2026-09-14", "00:00"),
          endsAt: instantFromWallClock("2026-09-14", "23:59"),
        }),
      ]),
    );
    expect(inclusive).toContain("DTEND;VALUE=DATE:20260915");
  });

  it("carries course and category so a subscribed calendar keeps the context", () => {
    const l = lines(feed([ev({ description: "Chapter 4" })]));
    expect(l).toContain("DESCRIPTION:Chapter 4\\nBIO 110\\nClasses");
    expect(l).toContain("LOCATION:Congdon 210");
  });

  it("has the calendar-level properties clients need to subscribe", () => {
    const l = lines(feed([ev()]));
    expect(l[0]).toBe("BEGIN:VCALENDAR");
    expect(l).toContain("VERSION:2.0");
    expect(l).toContain("CALSCALE:GREGORIAN");
    expect(l).toContain("METHOD:PUBLISH");
    expect(l).toContain("X-WR-CALNAME:High Point OS");
    expect(l).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(l.at(-1)).toBe("END:VCALENDAR");
  });

  it("every VEVENT has the four properties a feed must not omit", () => {
    const ics = feed([ev({ rrule: "FREQ=WEEKLY" }), ev({ id: "e2", title: "Lab" })]);
    const blocks = ics.split("BEGIN:VEVENT").slice(1);
    expect(blocks).toHaveLength(2);
    for (const b of blocks) {
      expect(b).toMatch(/\r\nUID:/);
      expect(b).toMatch(/\r\nDTSTAMP:\d{8}T\d{6}Z/);
      expect(b).toMatch(/\r\nDTSTART/);
      expect(b).toMatch(/\r\nSUMMARY:/);
    }
  });

  it("an empty calendar is still a valid file", () => {
    const l = lines(feed([]));
    expect(l[0]).toBe("BEGIN:VCALENDAR");
    expect(l.at(-1)).toBe("END:VCALENDAR");
    expect(l.filter((x) => x === "BEGIN:VEVENT")).toHaveLength(0);
  });

  it("a title full of separators survives the round trip", () => {
    const l = lines(feed([ev({ title: "Lab, room B; bring notes\\pens" })]));
    expect(l).toContain("SUMMARY:Lab\\, room B\\; bring notes\\\\pens");
  });
});
