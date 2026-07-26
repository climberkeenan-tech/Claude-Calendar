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

  it("reads a bare small hour as the afternoon, the way a student means it", () => {
    // chrono's own answer for all of these is AM.
    expect(time(parseLocal("Gym every Monday at 5", NOW).startIso!)).toBe("17:00");
    expect(time(parseLocal("Dinner at 6", NOW).startIso!)).toBe("18:00");
    expect(time(parseLocal("Practice at 4", NOW).startIso!)).toBe("16:00");
    expect(time(parseLocal("Study at 7", NOW).startIso!)).toBe("19:00");
  });

  it("a bare hour resolves to the SAME day as its explicit twin", () => {
    // The bug this locks out: chrono reads "at 5" as 5 AM, sees 5 AM today has
    // passed, and rolls the date to tomorrow. Bumping the hour to 5 PM
    // afterwards left it on tomorrow — so "Gym at 5" booked a day later than
    // "Gym at 5pm" from the same intent. The hour has to be corrected before
    // the day is decided.
    for (const [bare, explicit] of [
      ["Gym at 5", "Gym at 5pm"],
      ["Dinner at 6", "Dinner at 6pm"],
      ["Study at 7", "Study at 7pm"],
      ["Meeting at 2", "Meeting at 2pm"],
    ]) {
      const a = parseLocal(bare, NOW).startIso!;
      const b = parseLocal(explicit, NOW).startIso!;
      expect(`${bare} -> ${day(a)} ${time(a)}`).toBe(`${bare} -> ${day(b)} ${time(b)}`);
    }
    // …and that shared answer is TODAY, because 5 PM Monday is still ahead.
    expect(day(parseLocal("Gym at 5", NOW).startIso!)).toBe("2026-09-14");
  });

  it("an explicitly named day is never pulled backwards", () => {
    // Only a day chrono INFERRED may be re-decided. "Friday" was stated.
    expect(day(parseLocal("Study Friday at 7", NOW).startIso!)).toBe("2026-09-18");
    expect(time(parseLocal("Study Friday at 7", NOW).startIso!)).toBe("19:00");
    expect(day(parseLocal("Lab tomorrow at 3", NOW).startIso!)).toBe("2026-09-15");
    expect(day(parseLocal("Dinner on Sep 20 at 6", NOW).startIso!)).toBe("2026-09-20");
  });

  it("an explicit AM hour still rolls forward when it has passed", () => {
    // 5 AM Monday is gone; "5am" means tomorrow. Only the PM assumption is
    // re-decided, never chrono's ordinary forward-date behaviour.
    const d = parseLocal("Shift at 5am", NOW);
    expect(day(d.startIso!)).toBe("2026-09-15");
    expect(time(d.startIso!)).toBe("05:00");
  });

  it("reads a range's unstated end as the same afternoon, not the next morning", () => {
    // "9am to 5": chrono makes the end 5 AM, and because that precedes the
    // start it pushes it to the next day — a 9-to-5 becomes a 20-hour block.
    const nine = parseLocal("Meeting 9am to 5", NOW);
    expect(time(nine.startIso!)).toBe("09:00");
    expect(day(nine.endIso!)).toBe(day(nine.startIso!));
    expect(time(nine.endIso!)).toBe("17:00");

    const bare = parseLocal("Lab 1 to 3", NOW);
    expect(time(bare.startIso!)).toBe("13:00");
    expect(time(bare.endIso!)).toBe("15:00");

    const morning = parseLocal("Class 8am to 3", NOW);
    expect(time(morning.startIso!)).toBe("08:00");
    expect(time(morning.endIso!)).toBe("15:00");
  });

  it("keeps a genuine overnight range overnight", () => {
    // 2 PM would be BEFORE the 10 PM start, so the same-day reading is
    // rejected and chrono's next-day 2 AM stands.
    const d = parseLocal("Study 10pm to 2", NOW);
    expect(time(d.startIso!)).toBe("22:00");
    expect(day(d.endIso!)).toBe("2026-09-15");
    expect(time(d.endIso!)).toBe("02:00");
    expect(new Date(d.endIso!).getTime()).toBeGreaterThan(
      new Date(d.startIso!).getTime(),
    );
  });

  it("leaves an explicit meridiem and a plausible morning hour alone", () => {
    expect(time(parseLocal("Shift at 5am", NOW).startIso!)).toBe("05:00");
    expect(time(parseLocal("Shift at 5pm", NOW).startIso!)).toBe("17:00");
    expect(time(parseLocal("Class at 8", NOW).startIso!)).toBe("08:00");
    expect(time(parseLocal("Class at 9", NOW).startIso!)).toBe("09:00");
    expect(time(parseLocal("Quiz at 10", NOW).startIso!)).toBe("10:00");
    expect(time(parseLocal("Work at 12", NOW).startIso!)).toBe("12:00");
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

describe("a named day is a day, not the moment chrono filled in", () => {
  // chrono has to return an instant, so "Friday" comes back at whatever the
  // reference time-of-day was — noon for a bare weekday. Storing that verbatim
  // made the app call an essay overdue from 12:01 PM on the day it was due.
  // The dialog's manual path has always used 23:59; these keep them agreeing.
  it("a date-only deadline lands at the END of that day", () => {
    for (const text of [
      "Essay due Friday",
      "Lab report due tomorrow",
      "Problem set due Sep 20",
      "Reading due next Wednesday",
    ]) {
      const d = parseLocal(text, NOW);
      expect(d.kind).toBe("task");
      expect(d.allDay).toBe(true);
      expect(d.dueIso).not.toBeNull();
      expect(time(d.dueIso!)).toBe("23:59");
    }
  });

  it("keeps the day itself — end-of-day must not roll into tomorrow", () => {
    const friday = parseLocal("Essay due Friday", NOW);
    expect(day(friday.dueIso!)).toBe("2026-09-18");
    const tomorrow = parseLocal("Lab report due tomorrow", NOW);
    expect(day(tomorrow.dueIso!)).toBe("2026-09-15");
    const dated = parseLocal("Problem set due Sep 20", NOW);
    expect(day(dated.dueIso!)).toBe("2026-09-20");
  });

  it("a deadline WITH a stated time keeps that time", () => {
    const d = parseLocal("Essay due Friday at 5pm", NOW);
    expect(d.kind).toBe("task");
    expect(d.allDay).toBe(false);
    expect(day(d.dueIso!)).toBe("2026-09-18");
    expect(time(d.dueIso!)).toBe("17:00");
  });

  it("an AM range end is not dragged into the afternoon", () => {
    // The PM correction must not fire on "7" when the range opened at 6am —
    // the same-day-PM candidate has to fall INSIDE the range to be accepted.
    const d = parseLocal("Flight 6am-7", NOW);
    expect(time(d.startIso!)).toBe("06:00");
    expect(time(d.endIso!)).toBe("07:00");
  });
});

describe("the title is what's left after the date phrase, and nothing else", () => {
  // Found by typing into the real app: "Chem lab writeup due Thursday" landed
  // on the assignments board as "Chem lab writeup due".
  const titleOf = (s: string) => parseLocal(s, NOW).title;

  it("drops the preposition the date hung off", () => {
    expect(titleOf("Chem lab writeup due Thursday")).toBe("Chem lab writeup");
    expect(titleOf("Essay due Friday")).toBe("Essay");
    expect(titleOf("Lab report due by Friday")).toBe("Lab report");
    expect(titleOf("Study group at 5pm")).toBe("Study group");
    expect(titleOf("Dentist on Tuesday")).toBe("Dentist");
  });

  it("keeps a word that is part of the title itself", () => {
    // "due" only goes when it's trailing the date phrase, never mid-title.
    expect(titleOf("Pay tuition due balance Friday")).toBe("Pay tuition due balance");
    expect(titleOf("Reading")).toBe("Reading");
  });
});
