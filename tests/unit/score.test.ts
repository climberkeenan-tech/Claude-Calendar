import { describe, expect, it } from "vitest";
import {
  weeklyScore,
  winsAndNextAction,
  type WeekScoreInput,
} from "@/lib/analytics/score";

const base: WeekScoreInput = {
  tasksCompleted: 0,
  tasksCompletedLate: 0,
  tasksMissed: 0,
  focusMinutes: 0,
  focusTargetMinutesPerDay: null,
  habits: [],
  openOverdueNow: 0,
  usesTasks: false,
  daysElapsed: 7,
};

describe("weeklyScore", () => {
  it("returns null with no data at all — the tile simply doesn't render", () => {
    expect(weeklyScore(base).score).toBeNull();
  });

  it("perfect week scores 100 with all four components", () => {
    const { score, parts } = weeklyScore({
      tasksCompleted: 8,
      tasksCompletedLate: 0,
      tasksMissed: 0,
      focusMinutes: 7 * 60,
      focusTargetMinutesPerDay: 60,
      habits: [
        { done: 3, target: 3 },
        { done: 5, target: 5 },
      ],
      openOverdueNow: 0,
      usesTasks: true,
      daysElapsed: 7,
    });
    expect(parts).toHaveLength(4);
    expect(score).toBe(100);
  });

  it("GUARDRAIL: unused timer drops the focus component and renormalizes", () => {
    const withTimer = weeklyScore({
      ...base,
      tasksCompleted: 4,
      tasksMissed: 0,
      focusMinutes: 420,
      focusTargetMinutesPerDay: 60,
      usesTasks: true,
    });
    const timerUnused = weeklyScore({
      ...base,
      tasksCompleted: 4,
      tasksMissed: 0,
      focusMinutes: 0, // never started the timer — tracking gap, not failure
      focusTargetMinutesPerDay: 60,
      usesTasks: true,
    });
    // Focus part absent, and the score does NOT treat it as zero.
    expect(timerUnused.parts.map((p) => p.key)).toEqual(["onTime", "overdue"]);
    expect(timerUnused.score).toBe(100);
    expect(withTimer.score).toBe(100); // sanity: same perfect week with data
  });

  it("weights renormalize: half on-time with only that component = 50", () => {
    const { score, parts } = weeklyScore({
      ...base,
      tasksCompleted: 2,
      tasksCompletedLate: 1,
      tasksMissed: 0,
      usesTasks: false, // hypothetical: isolate the onTime part
    });
    expect(parts).toHaveLength(1);
    expect(score).toBe(50);
  });

  it("hand-computed blend: onTime .5, focus .8, overdue 2/3", () => {
    const { score } = weeklyScore({
      ...base,
      tasksCompleted: 3,
      tasksCompletedLate: 1,
      tasksMissed: 1, // onTime = 2/4 = .5
      focusMinutes: 336, // target 420 → .8
      focusTargetMinutesPerDay: 60,
      openOverdueNow: 1, // 1 - 1/3 = .6667
      usesTasks: true,
    });
    // (.4*.5 + .25*.8 + .15*.6667) / .8 = (0.2 + 0.2 + 0.1) / 0.8 = 0.625
    expect(score).toBe(63);
  });

  it("habit adherence caps per-habit at 100% (overshooting one habit can't mask another)", () => {
    const { parts } = weeklyScore({
      ...base,
      habits: [
        { done: 7, target: 3 }, // capped at 1
        { done: 0, target: 4 },
      ],
    });
    const habitPart = parts.find((p) => p.key === "habits")!;
    expect(habitPart.value).toBe(0.5);
  });

  it("GUARDRAIL: a perfect Monday scores 100, not 1/7th (prorated targets)", () => {
    const { score, parts } = weeklyScore({
      ...base,
      daysElapsed: 1,
      tasksCompleted: 1,
      focusMinutes: 60, // exactly one day's default target
      habits: [{ done: 1, target: 7 }], // 1/day pace, day one done
      usesTasks: true,
    });
    expect(parts.find((p) => p.key === "focus")!.value).toBe(1);
    expect(parts.find((p) => p.key === "habits")!.value).toBe(1);
    expect(score).toBe(100);
  });

  it("mid-week habit pacing: 2 of 3 by Wednesday-ish reads as on track, not failing", () => {
    const { parts } = weeklyScore({
      ...base,
      daysElapsed: 3,
      habits: [{ done: 2, target: 3 }], // expected pace: 3*3/7 ≈ 1.29
    });
    expect(parts.find((p) => p.key === "habits")!.value).toBe(1);
  });

  it("three or more overdue tasks floor the overdue component at 0", () => {
    const { parts } = weeklyScore({
      ...base,
      usesTasks: true,
      openOverdueNow: 5,
    });
    expect(parts.find((p) => p.key === "overdue")!.value).toBe(0);
  });
});

describe("winsAndNextAction", () => {
  it("leads with wins and exactly one action, framed as a move", () => {
    const input: WeekScoreInput = {
      ...base,
      tasksCompleted: 5,
      tasksMissed: 0,
      focusMinutes: 420,
      focusTargetMinutesPerDay: 60,
      openOverdueNow: 1,
      usesTasks: true,
    };
    const { parts } = weeklyScore(input);
    const { wins, nextAction } = winsAndNextAction(input, parts);
    expect(wins.length).toBeGreaterThan(0);
    expect(wins.length).toBeLessThanOrEqual(2);
    expect(nextAction).toMatch(/overdue/i); // weakest component drives it
    // Never shame-ware vocabulary:
    expect(`${wins.join(" ")} ${nextAction}`).not.toMatch(/procrastinat|fail|behind schedule|lazy/i);
  });

  it("clean week gets a calm nothing-needs-attention action", () => {
    const input: WeekScoreInput = {
      ...base,
      tasksCompleted: 3,
      focusMinutes: 500,
      focusTargetMinutesPerDay: 60,
      usesTasks: true,
    };
    const { parts } = weeklyScore(input);
    const { nextAction } = winsAndNextAction(input, parts);
    expect(nextAction).toMatch(/keep it rolling/i);
  });
});
