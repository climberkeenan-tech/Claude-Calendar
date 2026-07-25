import { describe, expect, it } from "vitest";
import { isoDayDiff, shiftIsoDate } from "@/lib/calendar/split";

/**
 * Regression guard for the "this & future" split. The old code derived the
 * shift from a weekday difference wrapped into [-3,+3], so same-week moves of
 * 4+ days went BACKWARD — cancelled classes reappeared and the wrong dates
 * got cancelled instead.
 */
describe("isoDayDiff — the real distance, never a wrapped weekday", () => {
  it("Monday → Friday of the same week is +4, not −3", () => {
    // Aug 17 2026 is a Monday; Aug 21 is that Friday.
    expect(isoDayDiff("2026-08-17", "2026-08-21")).toBe(4);
  });

  it("Monday → Sunday of the same week is +6", () => {
    expect(isoDayDiff("2026-08-17", "2026-08-23")).toBe(6);
  });

  it("backwards moves stay negative", () => {
    expect(isoDayDiff("2026-08-21", "2026-08-17")).toBe(-4);
  });

  it("a move into a later week keeps the full distance", () => {
    expect(isoDayDiff("2026-08-17", "2026-09-04")).toBe(18);
  });

  it("same day is zero", () => {
    expect(isoDayDiff("2026-08-17", "2026-08-17")).toBe(0);
  });

  it("spans DST boundaries without drifting (Nov 1 2026 fall-back)", () => {
    expect(isoDayDiff("2026-10-30", "2026-11-03")).toBe(4);
    expect(isoDayDiff("2026-03-06", "2026-03-10")).toBe(4); // spring forward
  });
});

describe("shiftIsoDate", () => {
  it("moves occurrence keys by whole calendar days", () => {
    expect(shiftIsoDate("2026-08-17", 4)).toBe("2026-08-21");
    expect(shiftIsoDate("2026-08-31", 1)).toBe("2026-09-01"); // month edge
    expect(shiftIsoDate("2026-01-01", -1)).toBe("2025-12-31"); // year edge
  });

  it("survives both DST transitions (noon anchor)", () => {
    expect(shiftIsoDate("2026-11-01", 1)).toBe("2026-11-02");
    expect(shiftIsoDate("2026-03-08", 1)).toBe("2026-03-09");
  });

  it("round-trips with isoDayDiff for a whole week of moves", () => {
    for (let d = -7; d <= 7; d++) {
      expect(isoDayDiff("2026-08-17", shiftIsoDate("2026-08-17", d))).toBe(d);
    }
  });
});
