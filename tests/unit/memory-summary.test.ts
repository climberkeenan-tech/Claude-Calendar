/**
 * The pattern summarizer decides what the app is willing to CLAIM about
 * someone. Two failure modes matter and they pull in opposite directions:
 * saying nothing when the evidence is there, and asserting a personality
 * from three data points. Most of these tests are about the second.
 */
import { describe, expect, it } from "vitest";
import { peakWindow, summarizePatterns } from "@/lib/memory/summary";
import type { UserPatterns } from "@/lib/analytics/patterns";

const flat = (v = 0) => Array.from({ length: 24 }, () => v);

const base: UserPatterns = {
  computedAt: "2026-07-26T08:00:00.000Z",
  estimateAccuracy: {},
  completionByHour: flat(),
  focusByHour: flat(),
  reminders: { sent: 0, acknowledged: 0, ignoreRate: 0 },
  lateCompletions: 0,
  totalOpenTasks: 0,
};

describe("peakWindow", () => {
  it("finds the three hours that hold the work", () => {
    const hours = flat();
    hours[9] = 100;
    hours[10] = 120;
    hours[11] = 80;
    expect(peakWindow(hours)).toMatchObject({ startHour: 9, endHour: 12 });
  });

  it("refuses to name a window when the day is flat", () => {
    // Evenly spread across 24 hours, any 3 hours hold 12.5% — naming one of
    // them "when you focus" would be an artifact of the tie-break, not a fact.
    expect(peakWindow(flat(10))).toBeNull();
  });

  it("returns null for no data at all rather than 12 AM–3 AM", () => {
    expect(peakWindow(flat())).toBeNull();
    expect(peakWindow(undefined)).toBeNull();
    expect(peakWindow([1, 2, 3])).toBeNull();
  });

  it("does not run off the end of the day", () => {
    const hours = flat();
    hours[22] = 50;
    hours[23] = 60;
    const w = peakWindow(hours);
    // The last window starts at 21; a naive loop to h<24 would read undefined
    // for hours 24 and 25 and quietly score them as zero. Hour 21 is empty, so
    // the reported window is trimmed to where the minutes actually are.
    expect(w?.startHour).toBe(22);
    expect(w?.endHour).toBe(24);
  });

  it("does not report an empty hour as when you work", () => {
    // 8 and 9 PM hold everything. Windows 19–22 and 20–23 score identically,
    // and the tie-break used to pick the first — announcing 7 PM, an hour with
    // nothing in it, as the start of the focus block.
    const hours = flat();
    hours[20] = 200;
    hours[21] = 180;
    expect(peakWindow(hours)).toMatchObject({ startHour: 20, endHour: 22 });
  });
});

describe("summarizePatterns", () => {
  it("says nothing at all for a brand-new account", () => {
    expect(summarizePatterns(base)).toEqual([]);
  });

  it("survives a blob written before a field existed", () => {
    // The column is untyped jsonb and last night's derivation may predate any
    // field here. It must degrade to fewer claims, not throw.
    expect(() => summarizePatterns({ computedAt: "x" })).not.toThrow();
    expect(summarizePatterns({ computedAt: "x" })).toEqual([]);
    expect(summarizePatterns(null)).toEqual([]);
    expect(summarizePatterns("nonsense")).toEqual([]);
  });

  it("reports underestimation with the multiplier and the sample count", () => {
    const lines = summarizePatterns({
      ...base,
      estimateAccuracy: { Homework: { ratio: 1.8, samples: 9 } },
    });
    expect(lines[0]).toContain("Homework");
    expect(lines[0]).toContain("1.8×");
    expect(lines[0]).toContain("9 timed items");
  });

  it("ignores a ratio built from one or two items", () => {
    // Two long afternoons is not a tendency.
    expect(
      summarizePatterns({
        ...base,
        estimateAccuracy: { Reading: { ratio: 3, samples: 2 } },
      }),
    ).toEqual([]);
  });

  it("ignores a ratio that is basically accurate", () => {
    expect(
      summarizePatterns({
        ...base,
        estimateAccuracy: { Lab: { ratio: 1.05, samples: 20 } },
      }),
    ).toEqual([]);
  });

  it("mentions overestimation too, in the other direction", () => {
    const lines = summarizePatterns({
      ...base,
      estimateAccuracy: { Practice: { ratio: 0.5, samples: 6 } },
    });
    expect(lines[0]).toContain("faster");
  });

  it("names at most three categories, worst first", () => {
    const lines = summarizePatterns({
      ...base,
      estimateAccuracy: {
        A: { ratio: 1.3, samples: 5 },
        B: { ratio: 2.5, samples: 5 },
        C: { ratio: 1.9, samples: 5 },
        D: { ratio: 1.5, samples: 5 },
      },
    });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("B");
  });

  it("converts focus hours to a readable window", () => {
    const focusByHour = flat();
    focusByHour[20] = 200;
    focusByHour[21] = 180;
    const lines = summarizePatterns({ ...base, focusByHour });
    expect(lines.join(" ")).toContain("8 PM");
    expect(lines.join(" ")).toContain("10 PM");
  });

  it("does not say the same window twice when focus and completions agree", () => {
    const hours = flat();
    hours[14] = 90;
    hours[15] = 90;
    const lines = summarizePatterns({
      ...base,
      focusByHour: hours,
      completionByHour: hours,
    });
    expect(lines).toHaveLength(1);
  });

  it("keeps quiet about reminders until there are enough to judge", () => {
    const lines = summarizePatterns({
      ...base,
      reminders: { sent: 2, acknowledged: 0, ignoreRate: 1 },
    });
    expect(lines.join(" ")).not.toContain("reminder");
  });

  it("flags reminders that are being tuned out", () => {
    const lines = summarizePatterns({
      ...base,
      reminders: { sent: 40, acknowledged: 6, ignoreRate: 0.85 },
    });
    expect(lines.join(" ")).toContain("85%");
  });

  it("counts late work without editorializing", () => {
    const lines = summarizePatterns({ ...base, lateCompletions: 1 });
    // Singular, because "1 items" reads like a bug and undermines the rest.
    expect(lines.join(" ")).toContain("1 item finished after the due date");
  });
});
