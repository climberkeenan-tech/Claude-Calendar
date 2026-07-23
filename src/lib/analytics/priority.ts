/**
 * Deterministic task auto-prioritization (Phase 6). Pure and unit-tested —
 * the AI suggests, but ordering must be explainable and instant.
 */

export type ScorableTask = {
  dueAt: Date | null;
  priority: "low" | "normal" | "high" | "critical";
  estimatedMinutes: number | null;
  categoryName: string | null;
};

const PRIORITY_WEIGHT: Record<ScorableTask["priority"], number> = {
  low: 0,
  normal: 10,
  high: 25,
  critical: 45,
};

const CATEGORY_WEIGHT: Record<string, number> = {
  Exams: 20,
  Homework: 10,
  Classes: 5,
};

/**
 * Higher = work on it sooner. Blend of deadline pressure (dominant),
 * explicit priority, category stakes, and a small bump for big estimates
 * (long work needs an earlier start).
 */
export function priorityScore(task: ScorableTask, now: Date): number {
  let score = PRIORITY_WEIGHT[task.priority];
  score += task.categoryName ? (CATEGORY_WEIGHT[task.categoryName] ?? 0) : 0;

  if (task.dueAt) {
    const hoursLeft = (task.dueAt.getTime() - now.getTime()) / 3_600_000;
    if (hoursLeft <= 0) score += 100; // overdue tops everything
    else if (hoursLeft <= 24) score += 80;
    else if (hoursLeft <= 48) score += 60;
    else if (hoursLeft <= 96) score += 40;
    else if (hoursLeft <= 24 * 7) score += 25;
    else score += 10;

    const estimate = task.estimatedMinutes ?? 0;
    if (estimate >= 120 && hoursLeft > 0 && hoursLeft <= 24 * 7) {
      score += Math.min(15, Math.round(estimate / 60) * 3);
    }
  }
  return score;
}

export function sortByPriority<T extends ScorableTask>(tasks: T[], now: Date): T[] {
  return [...tasks].sort((a, b) => {
    const diff = priorityScore(b, now) - priorityScore(a, now);
    if (diff !== 0) return diff;
    const aDue = a.dueAt?.getTime() ?? Infinity;
    const bDue = b.dueAt?.getTime() ?? Infinity;
    return aDue - bDue;
  });
}
