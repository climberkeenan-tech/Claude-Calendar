/**
 * The week planner + replan core (Phase 9) — deterministic, pure, tested.
 * No AI call here on purpose: proposing study blocks is arithmetic over
 * priorities, estimates, and free time. Deterministic means the user can
 * trust Accept, and "plan my week" finishes in minutes, not conversations.
 */
import { priorityScore } from "@/lib/analytics/priority";
import type { FreeBlock } from "./free-time";

export type PlanTask = {
  id: string;
  title: string;
  dueAt: Date | null;
  estimatedMinutes: number | null;
  priority: "low" | "normal" | "high" | "critical";
  categoryName: string | null;
};

export type ProposedBlock = {
  taskId: string;
  taskTitle: string;
  start: Date;
  end: Date;
  minutes: number;
};

/** Estimate fallbacks when the user hasn't set one — modest, per category. */
const DEFAULT_ESTIMATE: Record<string, number> = {
  Exams: 120, // studying for it
  Homework: 60,
  Classes: 45, // readings / prep
};
export function effectiveEstimate(t: PlanTask): number {
  return (
    t.estimatedMinutes ??
    DEFAULT_ESTIMATE[t.categoryName ?? ""] ??
    45
  );
}

/** Split an estimate into sittable sessions (25–90 min, ADHD-sized). */
export function chunkMinutes(total: number): number[] {
  const MAX = 90;
  const MIN = 25;
  const chunks: number[] = [];
  let left = Math.max(MIN, Math.min(total, 12 * 60)); // sanity cap: 12h
  while (left > 0) {
    if (left <= MAX) {
      chunks.push(Math.max(MIN, left));
      break;
    }
    chunks.push(MAX);
    left -= MAX;
  }
  return chunks;
}

/** Preference weight for an hour-of-day, from learned focusByHour patterns
 * (falls back to a sensible student default: afternoons + early evening). */
export function hourPreference(focusByHour: number[] | null): number[] {
  if (focusByHour && focusByHour.some((n) => n > 0)) {
    const max = Math.max(...focusByHour);
    return focusByHour.map((n) => n / max);
  }
  return Array.from({ length: 24 }, (_, h) =>
    h >= 14 && h <= 20 ? 1 : h >= 9 && h < 14 ? 0.7 : h >= 21 && h <= 22 ? 0.5 : 0.1,
  );
}

type Slot = { start: number; end: number }; // epoch ms, mutable remainder

/**
 * Greedy proposal: highest-priority work first, each chunk placed in the
 * best free slot that still respects the due date (finish BEFORE the thing
 * is due, never after) and the learned focus hours.
 */
export function proposeBlocks(opts: {
  tasks: PlanTask[];
  free: FreeBlock[];
  now: Date;
  focusByHour?: number[] | null;
  /** Hour extractor so callers control the timezone mapping (tests pass a
   * UTC-hour fn; production passes an America/New_York one). */
  hourOf: (d: Date) => number;
  maxBlocksPerTask?: number;
}): ProposedBlock[] {
  const pref = hourPreference(opts.focusByHour ?? null);
  const nowMs = opts.now.getTime();
  const MIN = 60_000;

  // Priority order — same engine as the Assignments page.
  const ordered = [...opts.tasks].sort(
    (a, b) =>
      priorityScore(
        { dueAt: b.dueAt, priority: b.priority, estimatedMinutes: b.estimatedMinutes, categoryName: b.categoryName },
        opts.now,
      ) -
      priorityScore(
        { dueAt: a.dueAt, priority: a.priority, estimatedMinutes: a.estimatedMinutes, categoryName: a.categoryName },
        opts.now,
      ),
  );

  // Mutable copies of the free blocks; chunks carve pieces off them.
  const slots: Slot[] = opts.free
    .map((f) => ({ start: Math.max(f.start.getTime(), nowMs), end: f.end.getTime() }))
    .filter((s) => s.end - s.start >= 25 * MIN)
    .sort((a, b) => a.start - b.start);

  const proposals: ProposedBlock[] = [];

  for (const task of ordered) {
    const chunks = chunkMinutes(effectiveEstimate(task)).slice(
      0,
      opts.maxBlocksPerTask ?? 4,
    );
    const dueMs = task.dueAt?.getTime() ?? Infinity;

    for (const chunk of chunks) {
      const need = chunk * MIN;
      // Candidates: slots that fit the chunk and end before the deadline.
      let best: { slot: Slot; score: number } | null = null;
      for (const slot of slots) {
        if (slot.end - slot.start < need) continue;
        if (slot.start + need > dueMs) continue; // would finish after due
        const hour = opts.hourOf(new Date(slot.start));
        // Earlier days win slightly (start early), preferred hours win more.
        const daysOut = (slot.start - nowMs) / 86_400_000;
        const score = pref[hour] * 2 - daysOut * 0.15;
        if (!best || score > best.score) best = { slot, score };
      }
      if (!best) continue; // nothing fits before the deadline — surfaced as overload elsewhere

      const start = best.slot.start;
      const end = start + need;
      proposals.push({
        taskId: task.id,
        taskTitle: task.title,
        start: new Date(start),
        end: new Date(end),
        minutes: chunk,
      });
      // Consume the slot front + a 15-minute breather before whatever's next.
      best.slot.start = end + 15 * MIN;
    }
  }

  return proposals.sort((a, b) => a.start.getTime() - b.start.getTime());
}
