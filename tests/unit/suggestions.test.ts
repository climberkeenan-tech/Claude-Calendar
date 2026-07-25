import { describe, expect, it } from "vitest";
import { buildSuggestions, type SuggestionInput } from "@/lib/scheduling/suggestions";
import type { FreeBlock } from "@/lib/scheduling/free-time";

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 15, h, m));
const hourOf = (d: Date) => d.getUTCHours();
const fb = (h1: number, h2: number): FreeBlock => ({
  start: at(h1),
  end: at(h2),
  minutes: (h2 - h1) * 60,
});

const input = (over: Partial<SuggestionInput> = {}): SuggestionInput => ({
  now: at(8),
  free: [fb(9, 21)],
  focusByHour: null,
  hourOf,
  busy: [],
  habitTitles: [],
  earliestCommitmentHour: null,
  plannedMinutesToday: 0,
  ...over,
});

describe("buildSuggestions", () => {
  it("offers your learned peak hour when it's actually open", () => {
    const peak = Array.from({ length: 24 }, (_, h) => (h === 16 ? 200 : 0));
    const s = buildSuggestions(input({ focusByHour: peak }));
    const study = s.find((x) => x.kind === "best_study_time");
    expect(study).toBeDefined();
    expect(hourOf(study!.start)).toBe(16);
    expect(study!.minutes).toBe(50);
  });

  it("doesn't offer a focus window that isn't free", () => {
    const peak = Array.from({ length: 24 }, (_, h) => (h === 16 ? 200 : 0));
    const s = buildSuggestions(
      input({ focusByHour: peak, free: [fb(9, 11)] }), // 4 PM is booked
    );
    expect(s.find((x) => x.kind === "best_study_time")).toBeUndefined();
  });

  it("suggests a break after a long unbroken run of commitments", () => {
    const s = buildSuggestions(
      input({
        busy: [
          { startsAt: at(9), endsAt: at(10), title: "BIO" },
          { startsAt: at(10, 10), endsAt: at(11), title: "CSC" },
          { startsAt: at(11, 5), endsAt: at(12, 30), title: "Lab" },
        ],
        free: [fb(12, 45), fb(13, 18)].map((b, i) => (i === 0 ? fb(12.75, 13) : b)),
      }),
    );
    expect(s.some((x) => x.kind === "break")).toBe(true);
  });

  it("no break suggestion for a light day", () => {
    const s = buildSuggestions(
      input({ busy: [{ startsAt: at(9), endsAt: at(10), title: "BIO" }] }),
    );
    expect(s.some((x) => x.kind === "break")).toBe(false);
  });

  it("offers deep work only when a genuinely long stretch exists", () => {
    expect(
      buildSuggestions(input({ free: [fb(9, 12)] })).some((x) => x.kind === "deep_work"),
    ).toBe(true);
    expect(
      buildSuggestions(input({ free: [fb(9, 10)] })).some((x) => x.kind === "deep_work"),
    ).toBe(false);
  });

  it("never suggests movement to someone already tracking a gym habit", () => {
    const withHabit = buildSuggestions(input({ habitTitles: ["Gym 3x a week"] }));
    expect(withHabit.some((x) => x.kind === "movement")).toBe(false);
  });

  it("wind-down only when something early is on the calendar", () => {
    const early = buildSuggestions(
      input({ free: [fb(9, 23)], earliestCommitmentHour: 8 }),
    );
    expect(early.some((x) => x.kind === "sleep_consistency")).toBe(true);
    const late = buildSuggestions(
      input({ free: [fb(9, 23)], earliestCommitmentHour: 13 }),
    );
    expect(late.some((x) => x.kind === "sleep_consistency")).toBe(false);
  });

  it("backs off on an already-packed day (no piling work on work)", () => {
    const peak = Array.from({ length: 24 }, (_, h) => (h === 16 ? 200 : 0));
    const s = buildSuggestions(
      input({ focusByHour: peak, plannedMinutesToday: 240 }),
    );
    expect(s.some((x) => x.kind === "best_study_time")).toBe(false);
    expect(s.some((x) => x.kind === "deep_work")).toBe(false);
  });

  it("never returns more than 3 — a nudge, not a wall", () => {
    const peak = Array.from({ length: 24 }, (_, h) => (h === 16 ? 200 : 0));
    const s = buildSuggestions(
      input({
        focusByHour: peak,
        free: [fb(9, 23)],
        earliestCommitmentHour: 8,
        busy: [
          { startsAt: at(6), endsAt: at(7), title: "A" },
          { startsAt: at(7, 5), endsAt: at(9), title: "B" },
        ],
      }),
    );
    expect(s.length).toBeLessThanOrEqual(3);
  });

  it("every suggestion carries a concrete block and a why", () => {
    const s = buildSuggestions(input({ free: [fb(9, 23)], earliestCommitmentHour: 8 }));
    for (const x of s) {
      expect(x.minutes).toBeGreaterThan(0);
      expect(x.start.getTime()).toBeGreaterThan(0);
      expect(x.rationale.length).toBeGreaterThan(0);
      expect(x.eventTitle.length).toBeGreaterThan(0);
      // Framed as a move, never a verdict.
      expect(x.title + x.rationale).not.toMatch(/wasted|lazy|failed|behind/i);
    }
  });
});
