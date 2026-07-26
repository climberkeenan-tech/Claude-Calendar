import ICAL from "ical.js";
import { describe, it } from "vitest";
import { buildFeed, type FeedEvent } from "@/lib/ics/feed";
import { renderCalendar } from "@/lib/ics/serialize";
import { instantFromWallClock } from "@/lib/time";

const mk = (day: string, now: Date, rrule: string | null = null): FeedEvent => ({
  id: "e1", title: "T", kind: "event", description: null, location: null,
  startsAt: instantFromWallClock(day, "09:00"),
  endsAt: instantFromWallClock(day, "09:50"),
  dueAt: null, allDay: false, rrule, tz: "America/New_York",
  categoryName: null, courseName: null, status: "scheduled", updatedAt: now,
});
function check(day: string, nowIso: string) {
  const now = new Date(nowIso);
  const s = renderCalendar(buildFeed({ events: [mk(day, now)], occurrencesByEvent: new Map(), domain: "d", calendarName: "C", now }));
  const c = new ICAL.Component(ICAL.parse(s));
  // fresh registration each time
  for (const vt of c.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(new ICAL.Timezone(vt));
  const e = new ICAL.Event(c.getAllSubcomponents("vevent")[0]);
  const got = e.startDate.toJSDate().toISOString();
  const want = instantFromWallClock(day, "09:00").toISOString();
  console.log(`feedYear=${now.getUTCFullYear()} event=${day}  got=${got} want=${want} ${got===want?"OK":"*** WRONG ***"}`);
  ICAL.TimezoneService.reset();
}
describe("coverage matrix", () => {
  it("matrix", () => {
    check("2026-01-05", "2026-01-15T12:00:00Z"); // same year, before first observance
    check("2026-02-20", "2026-01-15T12:00:00Z");
    check("2026-06-01", "2026-01-15T12:00:00Z");
    check("2025-10-15", "2026-01-15T12:00:00Z"); // prior year
    check("2025-12-20", "2026-01-15T12:00:00Z"); // prior year, winter
    check("2026-11-20", "2026-07-26T12:00:00Z");
  });
});
