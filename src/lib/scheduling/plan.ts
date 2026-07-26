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
  /** Minutes already covered by accepted plan blocks — re-running the
   * planner must top up, never double-book. */
  plannedMinutes?: number;
};

export type ProposedBlock = {
  taskId: string;
  taskTitle: string;
  start: Date;
  end: Date;
  minutes: number;
};

export type UnplaceableReason =
  | "already_planned"
  | "no_time_before_due"
  | "no_free_time"
  | "day_caps_reached";

export type Unplaceable = {
  taskId: string;
  title: string;
  reason: UnplaceableReason;
  /** Minutes we could not find a home for. */
  missingMinutes: number;
};

export type PlanResult = {
  proposals: ProposedBlock[];
  unplaceable: Unplaceable[];
  /** Set when a task's estimate exceeded what one plan may schedule — the
   * UI says so rather than silently truncating. */
  truncated: { taskId: string; title: string; scheduledMinutes: number }[];
};

/** Estimate fallbacks when the user hasn't set one — modest, per category. */
const DEFAULT_ESTIMATE: Record<string, number> = {
  Exams: 120, // studying for it
  Homework: 60,
  Classes: 45, // readings / prep
};
export function effectiveEstimate(t: PlanTask): number {
  return t.estimatedMinutes ?? DEFAULT_ESTIMATE[t.categoryName ?? ""] ?? 45;
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

type Slot = { start: number; end: number };

export type PlanOptions = {
  tasks: PlanTask[];
  free: FreeBlock[];
  now: Date;
  focusByHour?: number[] | null;
  /** Hour extractor so callers own the timezone mapping. */
  hourOf: (d: Date) => number;
  /** Local day key, likewise — used for day caps and spreading. */
  dayKeyOf: (d: Date) => string;
  /** Breather between a planned block and whatever comes next. */
  bufferMinutes?: number;
  /** Don't propose anything starting sooner than this (no ambush blocks). */
  minLeadMinutes?: number;
  /** Ceiling on planned study minutes per local day. */
  maxPerDayMinutes?: number;
  maxBlocksPerTask?: number;
  /** Minutes already planned per local day (existing accepted blocks). */
  existingPerDay?: Record<string, number>;
};

/**
 * Greedy proposal: highest-priority work first, each chunk placed in the
 * best free slot that still respects the due date (finish BEFORE the thing
 * is due), the day's ceiling, and the learned focus hours — spreading a
 * task's sittings across days rather than cramming them into one evening.
 */
export function proposeBlocks(opts: PlanOptions): PlanResult {
  const pref = hourPreference(opts.focusByHour ?? null);
  const buffer = (opts.bufferMinutes ?? 15) * 60_000;
  const leadMs = (opts.minLeadMinutes ?? 30) * 60_000;
  const perDayCap = opts.maxPerDayMinutes ?? 240;
  const maxBlocks = opts.maxBlocksPerTask ?? 4;
  const earliest = opts.now.getTime() + leadMs;
  const MIN = 60_000;
  /** Candidate start times are considered every half hour inside a slot. */
  const STEP = 30 * MIN;

  const ordered = [...opts.tasks].sort(
    (a, b) =>
      priorityScore(
        {
          dueAt: b.dueAt,
          priority: b.priority,
          estimatedMinutes: b.estimatedMinutes,
          categoryName: b.categoryName,
        },
        opts.now,
      ) -
      priorityScore(
        {
          dueAt: a.dueAt,
          priority: a.priority,
          estimatedMinutes: a.estimatedMinutes,
          categoryName: a.categoryName,
        },
        opts.now,
      ),
  );

  const slots: Slot[] = opts.free
    .map((f) => ({ start: Math.max(f.start.getTime(), earliest), end: f.end.getTime() }))
    .filter((s) => s.end - s.start >= 25 * MIN)
    .sort((a, b) => a.start - b.start);

  const perDay: Record<string, number> = { ...(opts.existingPerDay ?? {}) };
  const proposals: ProposedBlock[] = [];
  const unplaceable: Unplaceable[] = [];
  const truncated: PlanResult["truncated"] = [];

  for (const task of ordered) {
    const estimate = effectiveEstimate(task);
    const remaining = estimate - (task.plannedMinutes ?? 0);
    if (remaining < 25) {
      // Already covered by blocks the user accepted earlier — top-up only.
      if ((task.plannedMinutes ?? 0) > 0) {
        unplaceable.push({
          taskId: task.id,
          title: task.title,
          reason: "already_planned",
          missingMinutes: 0,
        });
      }
      continue;
    }

    const allChunks = chunkMinutes(remaining);
    const chunks = allChunks.slice(0, maxBlocks);
    if (chunks.length < allChunks.length) {
      truncated.push({
        taskId: task.id,
        title: task.title,
        scheduledMinutes: chunks.reduce((a, b) => a + b, 0),
      });
    }

    const dueMs = task.dueAt?.getTime() ?? Infinity;
    const daysUsed = new Set<string>();
    let missing = 0;
    let hadRoomSomewhere = false;

    for (const chunk of chunks) {
      const need = chunk * MIN;
      let best: { slot: Slot; start: number; score: number; day: string } | null = null;

      for (const slot of slots) {
        if (slot.end - slot.start < need) continue;
        // Score START TIMES INSIDE the slot, not just its opening instant.
        // Only ever scoring slot.start meant that on a wide-open day — one
        // free block running from breakfast to bedtime — every session was
        // pinned to the very start of it, so the learned focus hours the UI
        // advertises ("you focus best around 8 PM") changed nothing at all.
        const latest = slot.end - need;
        const candidates: number[] = [];
        for (let c = slot.start; c < latest; c += STEP) candidates.push(c);
        candidates.push(latest); // let a block finish flush with the slot

        for (const cand of candidates) {
          if (cand + need > dueMs) continue; // must finish before it's due
          hadRoomSomewhere = true;
          const day = opts.dayKeyOf(new Date(cand));
          if ((perDay[day] ?? 0) + chunk > perDayCap) continue; // day is full
          const hour = opts.hourOf(new Date(cand));
          const daysOut = (cand - opts.now.getTime()) / 86_400_000;
          // Prefer good hours, earlier days, and — importantly — a day this
          // task isn't already sitting on, so long work spreads out.
          const spreadPenalty = daysUsed.has(day) ? 1.2 : 0;
          const score = pref[hour] * 2 - daysOut * 0.15 - spreadPenalty;
          if (!best || score > best.score) best = { slot, start: cand, score, day };
        }
      }

      if (!best) {
        missing += chunk;
        continue;
      }

      const start = best.start;
      const end = start + need;
      proposals.push({
        taskId: task.id,
        taskTitle: task.title,
        start: new Date(start),
        end: new Date(end),
        minutes: chunk,
      });
      perDay[best.day] = (perDay[best.day] ?? 0) + chunk;
      daysUsed.add(best.day);
      // Placing a block later in a slot must not throw away the time before
      // it: keep the lead-in as its own slot when it's still long enough to
      // sit down with, or an evening-preferring plan would silently burn the
      // whole morning it skipped over.
      const leadIn = start - buffer;
      if (leadIn - best.slot.start >= 25 * MIN) {
        slots.push({ start: best.slot.start, end: leadIn });
      }
      best.slot.start = end + buffer; // breather before whatever's next
    }

    if (missing > 0) {
      unplaceable.push({
        taskId: task.id,
        title: task.title,
        reason:
          slots.length === 0
            ? "no_free_time"
            : hadRoomSomewhere
              ? "day_caps_reached"
              : // Blaming the deadline for a task that HAS no deadline is
                // just wrong — nothing was ruled out by a due date. What
                // actually happened is no gap was long enough to sit down in.
                task.dueAt
                ? "no_time_before_due"
                : "no_free_time",
        missingMinutes: missing,
      });
    }
  }

  return {
    proposals: proposals.sort((a, b) => a.start.getTime() - b.start.getTime()),
    unplaceable,
    truncated,
  };
}
