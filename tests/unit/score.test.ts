import { describe, expect, it } from "vitest";
import {
  excludeBacklogClears,
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

// ---------------------------------------------------------------------------
// The scorer is what turns a week of rows into one number the student is shown,
// so the one property it must never violate is that doing the right thing
// cannot lower it. Two shipped inputs broke that; these pin the shape of the
// inputs the fix now feeds in.
// ---------------------------------------------------------------------------

describe("the score never punishes doing the right thing", () => {
  const active: WeekScoreInput = {
    ...base,
    usesTasks: true,
    focusMinutes: 120,
    focusTargetMinutesPerDay: 60,
    habits: [{ done: 3, target: 5 }],
    daysElapsed: 3,
  };

  it("folds a backlog clear out of both sides of the ratio", () => {
    // The raw week sums for "task due last Sunday, finished this Monday":
    // it lands in the day rows as a completion AND as late, while the due day
    // that would offset it sits outside the window.
    const raw = { completed: 1, late: 1 };
    expect(excludeBacklogClears(raw, 1)).toEqual({ completed: 0, late: 0 });
    // Work genuinely done this week is untouched.
    expect(excludeBacklogClears({ completed: 4, late: 1 }, 1)).toEqual({
      completed: 3,
      late: 0,
    });
    // Never below zero, however the counts disagree.
    expect(excludeBacklogClears({ completed: 1, late: 0 }, 3)).toEqual({
      completed: 0,
      late: 0,
    });
  });

  it("so clearing old backlog is neutral, where it used to cost 34 points", () => {
    const ignored = weeklyScore(active).score;
    const folded = excludeBacklogClears({ completed: 1, late: 1 }, 1);
    const cleared = weeklyScore({
      ...active,
      tasksCompleted: folded.completed,
      tasksCompletedLate: folded.late,
    }).score;
    expect(cleared).toBe(ignored);

    // What shipped: the same week, scored without the fold.
    const unfixed = weeklyScore({
      ...active,
      tasksCompleted: 1,
      tasksCompletedLate: 1,
    }).score;
    expect(unfixed!).toBeLessThan(ignored!);
    expect(ignored).toBe(86);
    expect(unfixed).toBe(52);
  });

  it("a task dropped in triage must never reach tasksMissed", () => {
    // "Drop" sets status='cancelled'. getCalendarWindow and openOverdueNow both
    // hide it, so the app says the board is clear; the rollup's `due` query had
    // no status filter, so the score charged a blown deadline forever — a
    // finalized daily_stats row is never recomputed. The filter itself is SQL
    // (`ne(events.status, "cancelled")`); this pins what it is worth.
    const clean = weeklyScore({ ...active, tasksCompleted: 1 });
    expect(clean.parts.find((p) => p.key === "onTime")?.detail).toBe(
      "1 of 1 finished on time",
    );
    const counted = weeklyScore({
      ...active,
      tasksCompleted: 1,
      tasksMissed: 1,
    });
    expect(counted.parts.find((p) => p.key === "onTime")?.detail).toBe(
      "1 of 2 finished on time",
    );
    expect(counted.score!).toBeLessThan(clean.score!);
    expect(clean.score! - counted.score!).toBe(20);
  });

  it("finishing one more task on time can never lower the score", () => {
    for (const missed of [0, 1, 3]) {
      for (const done of [0, 1, 2, 5]) {
        const before = weeklyScore({
          ...active,
          tasksCompleted: done,
          tasksMissed: missed,
        }).score;
        const after = weeklyScore({
          ...active,
          tasksCompleted: done + 1,
          tasksMissed: missed,
        }).score;
        expect(after!).toBeGreaterThanOrEqual(before!);
      }
    }
  });
});

describe("the focus target follows the clock, not the calendar", () => {
  const monday = {
    ...base,
    usesTasks: true,
    daysElapsed: 1,
    focusTargetMinutesPerDay: 60,
  };

  it("ten minutes at 08:15 no longer scores worse than never starting", () => {
    // dayFraction ~0.018 of the 08:00-22:00 window => a 3-minute expectation,
    // so ten tracked minutes is comfortably ahead of pace rather than 17% of
    // a whole day's target.
    const tracked = weeklyScore({ ...monday, focusMinutes: 10, dayFraction: 0.018 });
    const untracked = weeklyScore({ ...monday, focusMinutes: 0 });
    expect(tracked.score!).toBeGreaterThanOrEqual(untracked.score!);

    // The shipped behaviour: a whole day's target charged at breakfast.
    const wholeDay = weeklyScore({ ...monday, focusMinutes: 10, dayFraction: 1 });
    expect(wholeDay.score!).toBeLessThan(untracked.score!);
  });

  it("the target grows as the day does", () => {
    const targetAt = (dayFraction: number) =>
      weeklyScore({ ...monday, focusMinutes: 30, dayFraction }).parts.find(
        (p) => p.key === "focus",
      )!.detail;
    expect(targetAt(0)).toContain("of 3 focus minutes"); // floor
    expect(targetAt(0.5)).toContain("of 30 focus minutes");
    expect(targetAt(1)).toContain("of 60 focus minutes");
  });

  it("finished days still count in full, and omitting the fraction is safe", () => {
    // Thursday: three whole days behind us plus all of today.
    const thursday = weeklyScore({
      ...base,
      usesTasks: true,
      daysElapsed: 4,
      focusTargetMinutesPerDay: 60,
      focusMinutes: 200,
      dayFraction: 1,
    });
    expect(thursday.parts.find((p) => p.key === "focus")!.detail).toContain(
      "of 240 focus minutes",
    );
    // No dayFraction means "all of today" — the shape every finished week has.
    const omitted = weeklyScore({
      ...base,
      usesTasks: true,
      daysElapsed: 4,
      focusTargetMinutesPerDay: 60,
      focusMinutes: 200,
    });
    expect(omitted.score).toBe(thursday.score);
  });
});
