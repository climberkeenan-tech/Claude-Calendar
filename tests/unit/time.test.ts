import { describe, expect, it } from "vitest";
import { dayBounds, leftLabel, untilLabel, relativeDue } from "@/lib/time";
import { contrastText } from "@/lib/utils";

describe("dayBounds (America/New_York)", () => {
  it("brackets an ordinary EST evening correctly", () => {
    // 2026-01-15 21:00 EST = 02:00Z on the 16th
    const now = new Date("2026-01-16T02:00:00Z");
    const { start, end, isoDay } = dayBounds(now);
    expect(isoDay).toBe("2026-01-15");
    expect(start.toISOString()).toBe("2026-01-15T05:00:00.000Z"); // midnight EST
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("brackets an EDT (summer) morning correctly", () => {
    // 2026-07-20 08:00 EDT = 12:00Z
    const now = new Date("2026-07-20T12:00:00Z");
    const { start, isoDay } = dayBounds(now);
    expect(isoDay).toBe("2026-07-20");
    expect(start.toISOString()).toBe("2026-07-20T04:00:00.000Z"); // midnight EDT
  });

  it("assigns a UTC-early instant to the previous New York day", () => {
    // 2026-03-10 01:30Z = 2026-03-09 20:30 EST
    const now = new Date("2026-03-10T01:30:00Z");
    expect(dayBounds(now).isoDay).toBe("2026-03-09");
  });

  it("spring-forward day is 23 hours, fall-back day is 25", () => {
    const spring = dayBounds(new Date("2026-03-08T15:00:00Z")); // Mar 8 EDT begins
    expect(spring.start.toISOString()).toBe("2026-03-08T05:00:00.000Z"); // midnight EST
    expect(spring.end.toISOString()).toBe("2026-03-09T04:00:00.000Z"); // midnight EDT
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 3600_000);

    const fall = dayBounds(new Date("2026-11-01T15:00:00Z")); // Nov 1 EST returns
    expect(fall.end.getTime() - fall.start.getTime()).toBe(25 * 3600_000);
  });
});

describe("relativeDue calendar-day labels", () => {
  it("says tomorrow for a next-calendar-day deadline even <24h away", () => {
    // Now: 11 PM EST Jan 15 (04:00Z Jan 16). Due: 8 AM EST Jan 16 — 9h away
    // but a different calendar day.
    const now = new Date("2026-01-16T04:00:00Z");
    const due = new Date("2026-01-16T13:00:00Z");
    expect(relativeDue(now, due)).toMatch(/^tomorrow /);
  });
  it("still says today for a same-day deadline", () => {
    const now = new Date("2026-01-15T14:00:00Z"); // 9 AM EST
    const due = new Date("2026-01-16T02:00:00Z"); // 9 PM EST same day
    expect(relativeDue(now, due)).toMatch(/^today /);
  });

  it("labels the right day in the hour before spring-forward", () => {
    // Sat Mar 7 2026, 11:30 PM EST. Sunday Mar 8 is the 23-hour day, so
    // now+24h lands on Mar 9 — "tomorrow" must still mean Mar 8.
    const now = new Date("2026-03-08T04:30:00Z");
    const dueMar8 = new Date("2026-03-08T13:00:00Z"); // Sun 9 AM EDT
    const dueMar9 = new Date("2026-03-09T13:00:00Z"); // Mon 9 AM EDT
    expect(relativeDue(now, dueMar8)).toMatch(/^tomorrow /);
    expect(relativeDue(now, dueMar9)).not.toMatch(/^tomorrow /);
  });
});

describe("countdown labels", () => {
  const t0 = new Date("2026-07-20T12:00:00Z");
  it("formats minutes and hours", () => {
    expect(untilLabel(t0, new Date("2026-07-20T12:40:00Z"))).toBe("in 40 min");
    expect(untilLabel(t0, new Date("2026-07-20T15:20:00Z"))).toBe("in 3 h 20 min");
    expect(untilLabel(t0, new Date("2026-07-20T14:00:00Z"))).toBe("in 2 h");
    expect(untilLabel(t0, t0)).toBe("now");
  });
  it("formats time remaining", () => {
    expect(leftLabel(t0, new Date("2026-07-20T12:25:00Z"))).toBe("25 min left");
    expect(leftLabel(t0, new Date("2026-07-20T11:59:00Z"))).toBe("wrapping up");
  });
  it("labels due dates relative to now", () => {
    expect(relativeDue(t0, new Date("2026-07-19T00:00:00Z"))).toBe("overdue");
    expect(relativeDue(t0, new Date("2026-07-20T21:00:00Z"))).toMatch(/^today /);
  });
});

describe("contrastText", () => {
  it("returns readable text for every default category color", () => {
    const colors: Record<string, string> = {
      "#6A9BCC": contrastText("#6A9BCC"),
      "#D97757": contrastText("#D97757"),
      "#BF4D43": contrastText("#BF4D43"),
      "#7D9B76": contrastText("#7D9B76"),
      "#C2A87D": contrastText("#C2A87D"),
      "#A187BE": contrastText("#A187BE"),
    };
    // Only the darkest background (exam red) needs white text; the rest sit
    // above the 0.179 luminance crossover where dark text has more contrast.
    expect(colors["#BF4D43"]).toBe("#ffffff");
    expect(colors["#D97757"]).toBe("#1f1e1d");
    expect(colors["#C2A87D"]).toBe("#1f1e1d");
    expect(colors["#6A9BCC"]).toBe("#1f1e1d");
    // Falls back safely on malformed input
    expect(contrastText("not-a-color")).toBe("#1f1e1d");
  });
});
