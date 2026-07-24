/**
 * Pure daily-stats math (ARCHITECTURE §8) — no I/O and no db import, so the
 * hand-computed fixtures in tests/unit/rollup.test.ts exercise exactly what
 * production runs. rollup.ts feeds this from queries.
 */

/** Waking window for "free time": 08:00–22:00 local. Free minutes = that
 * window minus scheduled (non-all-day) event overlap. */
export const WAKE_START = "08:00:00";
export const WAKE_END = "22:00:00";

export type DayStatsInput = {
  dayStart: Date;
  dayEnd: Date;
  wakeStart: Date;
  wakeEnd: Date;
  /** Focus sessions STARTED in [dayStart, dayEnd). */
  focus: { startedAt: Date; durationMinutes: number | null; label: string }[];
  /** Tasks completed in the window. */
  completed: { completedAt: Date; dueAt: Date | null }[];
  /** Tasks due in the window (whatever their current state). */
  due: { dueAt: Date; completedAt: Date | null }[];
  /** Timed scheduled blocks overlapping the day (recurring pre-expanded). */
  busy: { startsAt: Date; endsAt: Date }[];
};

export type DayStatsRow = {
  minutesStudied: number;
  minutesByCategory: Record<string, number>;
  freeMinutes: number;
  avgWorkSessionMinutes: number | null;
  tasksCompleted: number;
  tasksCompletedLate: number;
  tasksOverdue: number;
  focusSessionCount: number;
};

/** Overlap of merged [start,end) intervals with a window, in minutes. */
export function busyMinutesInWindow(
  blocks: { startsAt: Date; endsAt: Date }[],
  winStart: Date,
  winEnd: Date,
): number {
  const clipped = blocks
    .map((b) => ({
      start: Math.max(b.startsAt.getTime(), winStart.getTime()),
      end: Math.min(b.endsAt.getTime(), winEnd.getTime()),
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

  let total = 0;
  let curStart = -Infinity;
  let curEnd = -Infinity;
  for (const b of clipped) {
    if (b.start > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = b.start;
      curEnd = b.end;
    } else {
      curEnd = Math.max(curEnd, b.end);
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return Math.round(total / 60_000);
}

/**
 * @param asOf For the LIVE today computation only: "missed" is judged
 * against this moment, so a task due at 9 PM isn't already "missed" at
 * 9 AM. Finalized (nightly) rollups omit it — end-of-day semantics.
 */
export function computeDayStats(i: DayStatsInput, asOf?: Date): DayStatsRow {
  const inDay = (d: Date) => d >= i.dayStart && d < i.dayEnd;

  const focusRows = i.focus.filter((f) => inDay(f.startedAt));
  const durations = focusRows
    .map((f) => f.durationMinutes ?? 0)
    .filter((n) => n > 0);
  const minutesStudied = durations.reduce((a, b) => a + b, 0);

  const minutesByCategory: Record<string, number> = {};
  for (const f of focusRows) {
    const mins = f.durationMinutes ?? 0;
    if (mins <= 0) continue;
    minutesByCategory[f.label] = (minutesByCategory[f.label] ?? 0) + mins;
  }

  const completed = i.completed.filter((c) => inDay(c.completedAt));
  const late = completed.filter((c) => c.dueAt && c.completedAt > c.dueAt);

  // "Missed" = came due this day and still wasn't done by end of day.
  // Live-today runs clamp to "now": a deadline that hasn't arrived yet is
  // not a miss (guardrail — never judge what hasn't happened).
  const cutoff = asOf && asOf < i.dayEnd ? asOf : i.dayEnd;
  const overdue = i.due.filter(
    (d) =>
      inDay(d.dueAt) &&
      d.dueAt < cutoff &&
      (!d.completedAt || d.completedAt >= i.dayEnd),
  );

  const wakeTotal = Math.round(
    (i.wakeEnd.getTime() - i.wakeStart.getTime()) / 60_000,
  );
  const busy = busyMinutesInWindow(i.busy, i.wakeStart, i.wakeEnd);
  const freeMinutes = Math.max(0, wakeTotal - busy);

  return {
    minutesStudied,
    minutesByCategory,
    freeMinutes,
    avgWorkSessionMinutes:
      durations.length > 0
        ? Number((minutesStudied / durations.length).toFixed(1))
        : null,
    tasksCompleted: completed.length,
    tasksCompletedLate: late.length,
    tasksOverdue: overdue.length,
    focusSessionCount: focusRows.length,
  };
}
