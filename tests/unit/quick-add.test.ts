import { afterEach, describe, expect, it } from "vitest";
import { parseLocal } from "@/lib/ai/quick-add";
import { instantFromWallClock, isoDay, timeValue, weekdayIndex } from "@/lib/time";

// A fixed "now": Monday 2026-09-14 10:00 on campus (America/New_York).
const NOW = instantFromWallClock("2026-09-14", "10:00");

/** What the calendar will actually show — campus wall clock, never the host's. */
const day = (iso: string) => isoDay(new Date(iso));
const time = (iso: string) => timeValue(new Date(iso));

describe("parseLocal — the brief's acceptance phrasings", () => {
  it("Study Biology tomorrow at 7 PM", () => {
    const d = parseLocal("Study Biology tomorrow at 7 PM", NOW);
    expect(d.startIso).not.toBeNull();
    expect(day(d.startIso!)).toBe("2026-09-15");
    expect(time(d.startIso!)).toBe("19:00");
    expect(d.allDay).toBe(false);
    expect(d.title.toLowerCase()).toContain("biology");
    expect(d.categoryName).toBe("Classes"); // "study" hint
  });

  it("Gym every Monday at 5 → recurring habit", () => {
    const d = parseLocal("Gym every Monday at 5", NOW);
    expect(d.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(d.rruleLabel).toBe("every Monday");
    expect(d.kind).toBe("habit");
    expect(d.habitTargetPerWeek).toBe(1);
    expect(d.title.toLowerCase()).toContain("gym");
  });

  it("Exam next Friday → all-day with Exams category", () => {
    const d = parseLocal("Exam next Friday", NOW);
    expect(d.startIso).not.toBeNull();
    expect(d.categoryName).toBe("Exams");
    expect(d.allDay).toBe(true);
    expect(weekdayIndex(day(d.startIso!))).toBe(4); // a Friday, on campus
    expect(new Date(d.startIso!).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("Essay due Friday → task with deadline", () => {
    const d = parseLocal("Essay due Friday", NOW);
    expect(d.kind).toBe("task");
    expect(d.dueIso).not.toBeNull();
    expect(d.startIso).toBeNull();
    expect(d.categoryName).toBe("Homework"); // "essay" hint
  });

  it("Bio homework due tomorrow at noon", () => {
    const d = parseLocal("Bio homework due tomorrow at noon", NOW);
    expect(d.kind).toBe("task");
    expect(day(d.dueIso!)).toBe("2026-09-15");
    expect(time(d.dueIso!)).toBe("12:00");
  });

  it("Practice every Tuesday and Thursday at 4pm", () => {
    const d = parseLocal("Practice every Tuesday and Thursday at 4pm", NOW);
    expect(d.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
    expect(d.habitTargetPerWeek).toBe(2);
  });

  it("Meditate every day", () => {
    const d = parseLocal("Meditate every day", NOW);
    expect(d.rrule).toBe("FREQ=DAILY");
    expect(d.kind).toBe("habit");
  });

  it("Dinner with Sam Thursday 6:30-8pm keeps the range", () => {
    const d = parseLocal("Dinner with Sam Thursday 6:30-8pm", NOW);
    expect(time(d.startIso!)).toBe("18:30");
    expect(time(d.endIso!)).toBe("20:00");
  });

  it("Call mom (no date) → Inbox-bound with no anchor", () => {
    const d = parseLocal("Call mom", NOW);
    expect(d.startIso).toBeNull();
    expect(d.dueIso).toBeNull();
    expect(d.title).toBe("Call mom");
  });

  it("Work shift Saturday 9am → Work category", () => {
    const d = parseLocal("Work shift Saturday 9am", NOW);
    expect(d.categoryName).toBe("Work");
    expect(day(d.startIso!)).toBe("2026-09-19"); // Saturday
    expect(time(d.startIso!)).toBe("09:00");
  });

  it("strips filler and keeps a clean title", () => {
    const d = parseLocal("Study chemistry on Wednesday at 3pm", NOW);
    expect(d.title.toLowerCase()).toMatch(/^study chemistry/);
    expect(d.title.toLowerCase()).not.toContain("wednesday");
  });

  it("parseLocal is fast enough for per-keystroke use", () => {
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      parseLocal("Study Biology tomorrow at 7 PM and gym every Monday", NOW);
    }
    const perCall = (performance.now() - t0) / 200;
    expect(perCall).toBeLessThan(15); // ms — far under the 1.5 s p95 gate
  });
});

/**
 * Travelling: the laptop moves, campus doesn't. Quick-add must keep meaning
 * campus time no matter what the host clock says — otherwise a study-abroad
 * flight silently rewrites the whole semester by three hours.
 */
describe("parseLocal from another timezone", () => {
  const HOST_TZ = process.env.TZ;
  afterEach(() => {
    process.env.TZ = HOST_TZ;
  });

  const zones = ["America/Los_Angeles", "Asia/Tokyo", "Europe/London", "UTC"];

  it("resolves the same campus instant from every host timezone", () => {
    const results = zones.map((tz) => {
      process.env.TZ = tz;
      return parseLocal("Study Biology tomorrow at 7 PM", NOW).startIso;
    });
    expect(new Set(results).size).toBe(1);
    expect(day(results[0]!)).toBe("2026-09-15");
    expect(time(results[0]!)).toBe("19:00");
  });

  it("keeps 'tomorrow' anchored to the campus day, not the host day", () => {
    // 11 PM Monday in Los Angeles is already 2 AM *Tuesday* on campus, so
    // "tomorrow" has to mean Wednesday the 16th.
    const lateInLA = instantFromWallClock("2026-09-15", "02:00"); // campus clock
    process.env.TZ = "America/Los_Angeles";
    const d = parseLocal("Lab tomorrow at 9am", lateInLA);
    expect(day(d.startIso!)).toBe("2026-09-16");
    expect(time(d.startIso!)).toBe("09:00");
  });

  it("survives a host zone with a half-hour offset", () => {
    process.env.TZ = "Asia/Kolkata"; // UTC+05:30
    const d = parseLocal("Dinner with Sam Thursday 6:30-8pm", NOW);
    expect(time(d.startIso!)).toBe("18:30");
    expect(time(d.endIso!)).toBe("20:00");
  });
});
