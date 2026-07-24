import { describe, expect, it } from "vitest";
import {
  busyMinutesInWindow,
  computeDayStats,
  type DayStatsInput,
} from "@/lib/analytics/rollup-core";
import { fromFloating } from "@/lib/tz";

const TZ = "America/New_York";
const local = (s: string) => fromFloating(new Date(`${s}Z`), TZ);

/** Ordinary Tuesday fixture: Sep 15 2026. */
function day(overrides: Partial<DayStatsInput> = {}): DayStatsInput {
  return {
    dayStart: local("2026-09-15T00:00:00"),
    dayEnd: local("2026-09-16T00:00:00"),
    wakeStart: local("2026-09-15T08:00:00"),
    wakeEnd: local("2026-09-15T22:00:00"),
    focus: [],
    completed: [],
    due: [],
    busy: [],
    ...overrides,
  };
}

describe("computeDayStats — hand-computed fixtures", () => {
  it("empty day: 840 free minutes (8am–10pm), zeros elsewhere", () => {
    const r = computeDayStats(day());
    expect(r).toEqual({
      minutesStudied: 0,
      minutesByCategory: {},
      freeMinutes: 840,
      avgWorkSessionMinutes: null,
      tasksCompleted: 0,
      tasksCompletedLate: 0,
      tasksOverdue: 0,
      focusSessionCount: 0,
    });
  });

  it("a full student day, every number checked by hand", () => {
    const r = computeDayStats(
      day({
        focus: [
          { startedAt: local("2026-09-15T09:00:00"), durationMinutes: 50, label: "Classes" },
          { startedAt: local("2026-09-15T15:00:00"), durationMinutes: 25, label: "Homework" },
          { startedAt: local("2026-09-15T20:00:00"), durationMinutes: 45, label: "Homework" },
          // Running session (no duration yet) counts for count, not minutes:
          { startedAt: local("2026-09-15T21:30:00"), durationMinutes: null, label: "Study" },
        ],
        completed: [
          // On time:
          { completedAt: local("2026-09-15T10:00:00"), dueAt: local("2026-09-15T23:59:00") },
          // Late (was due yesterday):
          { completedAt: local("2026-09-15T11:00:00"), dueAt: local("2026-09-14T23:59:00") },
          // No due date — counts as completed, never late:
          { completedAt: local("2026-09-15T12:00:00"), dueAt: null },
        ],
        due: [
          // Done early that day → not overdue:
          { dueAt: local("2026-09-15T23:59:00"), completedAt: local("2026-09-15T10:00:00") },
          // Still open → missed:
          { dueAt: local("2026-09-15T17:00:00"), completedAt: null },
          // Completed days later → still missed for THIS day:
          { dueAt: local("2026-09-15T12:00:00"), completedAt: local("2026-09-18T09:00:00") },
        ],
        busy: [
          // Class 10:00–10:50 (50), lab 14:00–15:50 (110), overlapping club
          // 15:30–16:30 (adds 40 beyond the lab) → merged busy = 200.
          { startsAt: local("2026-09-15T10:00:00"), endsAt: local("2026-09-15T10:50:00") },
          { startsAt: local("2026-09-15T14:00:00"), endsAt: local("2026-09-15T15:50:00") },
          { startsAt: local("2026-09-15T15:30:00"), endsAt: local("2026-09-15T16:30:00") },
        ],
      }),
    );
    expect(r.minutesStudied).toBe(120); // 50+25+45
    expect(r.minutesByCategory).toEqual({ Classes: 50, Homework: 70 });
    expect(r.focusSessionCount).toBe(4);
    expect(r.avgWorkSessionMinutes).toBe(40); // 120/3 finished sessions
    expect(r.tasksCompleted).toBe(3);
    expect(r.tasksCompletedLate).toBe(1);
    expect(r.tasksOverdue).toBe(2);
    expect(r.freeMinutes).toBe(840 - 200);
  });

  it("busy blocks clip to the waking window (an 11pm thing costs no free time)", () => {
    const r = computeDayStats(
      day({
        busy: [
          // 6:00–9:00 → only 8:00–9:00 inside the window (60)
          { startsAt: local("2026-09-15T06:00:00"), endsAt: local("2026-09-15T09:00:00") },
          // 22:30–23:30 → fully outside (0)
          { startsAt: local("2026-09-15T22:30:00"), endsAt: local("2026-09-15T23:30:00") },
        ],
      }),
    );
    expect(r.freeMinutes).toBe(840 - 60);
  });

  it("DST fall-back day (Nov 1 2026): waking window is still 840 wall minutes", () => {
    const r = computeDayStats({
      ...day(),
      dayStart: local("2026-11-01T00:00:00"),
      dayEnd: local("2026-11-02T00:00:00"),
      wakeStart: local("2026-11-01T08:00:00"),
      wakeEnd: local("2026-11-01T22:00:00"),
    });
    // The repeated 1–2am hour is outside 8am–10pm; free time must not
    // become 900.
    expect(r.freeMinutes).toBe(840);
  });

  it("DST spring-forward day (Mar 8 2026): same 840", () => {
    const r = computeDayStats({
      ...day(),
      dayStart: local("2026-03-08T00:00:00"),
      dayEnd: local("2026-03-09T00:00:00"),
      wakeStart: local("2026-03-08T08:00:00"),
      wakeEnd: local("2026-03-08T22:00:00"),
    });
    expect(r.freeMinutes).toBe(840);
  });

  it("LIVE GUARDRAIL: asOf stops deadlines later today from counting as missed", () => {
    const inputs = day({
      due: [
        // Due 9 PM tonight, still open — NOT missed at 10 AM:
        { dueAt: local("2026-09-15T21:00:00"), completedAt: null },
        // Due 9 AM this morning, still open — genuinely late already:
        { dueAt: local("2026-09-15T09:00:00"), completedAt: null },
      ],
    });
    const liveAt10am = computeDayStats(inputs, local("2026-09-15T10:00:00"));
    expect(liveAt10am.tasksOverdue).toBe(1);
    // Finalized (no asOf): both count — the day is over.
    expect(computeDayStats(inputs).tasksOverdue).toBe(2);
  });

  it("sessions outside the day are ignored even if passed in", () => {
    const r = computeDayStats(
      day({
        focus: [
          { startedAt: local("2026-09-14T23:00:00"), durationMinutes: 60, label: "X" },
          { startedAt: local("2026-09-16T00:00:00"), durationMinutes: 60, label: "X" },
        ],
      }),
    );
    expect(r.minutesStudied).toBe(0);
    expect(r.focusSessionCount).toBe(0);
  });
});

describe("busyMinutesInWindow", () => {
  const w = {
    start: local("2026-09-15T08:00:00"),
    end: local("2026-09-15T22:00:00"),
  };
  it("merges overlapping and touching intervals", () => {
    expect(
      busyMinutesInWindow(
        [
          { startsAt: local("2026-09-15T09:00:00"), endsAt: local("2026-09-15T10:00:00") },
          { startsAt: local("2026-09-15T09:30:00"), endsAt: local("2026-09-15T10:30:00") },
          { startsAt: local("2026-09-15T10:30:00"), endsAt: local("2026-09-15T11:00:00") },
        ],
        w.start,
        w.end,
      ),
    ).toBe(120);
  });
  it("returns 0 for empty input", () => {
    expect(busyMinutesInWindow([], w.start, w.end)).toBe(0);
  });
});
