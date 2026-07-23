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
