"use server";

/**
 * Plan-my-week, replan, and overdue triage (Phase 9).
 *
 * Accept is the only write path and it re-validates EVERYTHING server-side:
 * ownership of every task, sane block shapes, and a fresh collision check
 * against the calendar as it exists at accept time — the proposal the user
 * reviewed may be minutes old. Every created block is tagged
 * source='ai_suggestion' + sourceId='plan:<batch>:<task>' so one query
 * undoes a whole plan.
 */
import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, like, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { activityLog, categories, events, reminders } from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";
import { fromFloating, isoDayInTz } from "@/lib/tz";
import { syncJobsForEvent, acknowledgeJobsForEvent } from "@/lib/notifications/scheduler";
import { freeBlocks } from "@/lib/scheduling/free-time";
import { proposeBlocks, effectiveEstimate } from "@/lib/scheduling/plan";
import {
  freeByDay,
  getBusyBlocks,
  getFocusByHour,
  getPlanTasks,
  getSchedulingPrefs,
  localDayKey,
  localHourOf,
  overloadDays,
  shiftIso,
  warningsForRange,
  type DayFree,
  type OverloadDay,
} from "@/lib/scheduling/context";
import { buildSuggestions, type Suggestion } from "@/lib/scheduling/suggestions";

const TZ = "America/New_York";
const DAY = 86_400_000;

const refresh = () => {
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/assignments");
  revalidatePath("/plan");
};

// ---------------------------------------------------------------------------
// Context (read-only) — powers /plan in both modes
// ---------------------------------------------------------------------------

export type PlanProposal = {
  taskId: string;
  taskTitle: string;
  startIso: string; // UTC instant
  minutes: number;
  dayIso: string; // local day for grouping
};

export type PlanContext = {
  mode: "week" | "today";
  proposals: PlanProposal[];
  taskCount: number;
  unplaceable: { taskId: string; title: string; reason: string; missingMinutes: number }[];
  truncated: { taskId: string; title: string; scheduledMinutes: number }[];
  suggestions: {
    kind: string;
    title: string;
    rationale: string;
    startIso: string;
    minutes: number;
    eventTitle: string;
    categoryName: string | null;
  }[];
  prefs: { bufferMinutes: number; dayStart: string; dayEnd: string; maxPlanMinutesPerDay: number };
  warnings: { from: string; to: string; gapMinutes: number }[];
  overload: OverloadDay[];
  freeSummary: { dayIso: string; freeMinutes: number }[];
  focusHint: string | null;
  /** Replan mode: stale planned blocks that will be swept on accept. */
  staleBlockIds: string[];
};

function focusHintFrom(focusByHour: number[] | null): string | null {
  if (!focusByHour || focusByHour.every((n) => n === 0)) return null;
  const best = focusByHour.indexOf(Math.max(...focusByHour));
  const label = (h: number) =>
    h === 0 ? "midnight" : h < 12 ? `${h} AM` : h === 12 ? "noon" : `${h - 12} PM`;
  return `You've focused best around ${label(best)} — blocks lean that way.`;
}

export async function getPlanContext(
  mode: "week" | "today",
): Promise<PlanContext> {
  const userId = await requireUserId();
  const now = new Date();
  const todayIso = isoDayInTz(now, TZ);
  const horizon = mode === "week" ? 7 : 2;

  const rangeEnd = fromFloating(
    new Date(`${shiftIso(todayIso, horizon)}T00:00:00Z`),
    TZ,
  );
  const [busy, allTasks, focusByHour, prefs] = await Promise.all([
    getBusyBlocks(userId, now, rangeEnd),
    getPlanTasks(userId, mode === "week" ? 14 : 3),
    getFocusByHour(userId),
    getSchedulingPrefs(userId),
  ]);

  // Blocks this user already accepted, so re-planning tops up instead of
  // double-booking, and day ceilings count what's already there.
  const existingPlanBlocks = await db
    .select({
      sourceId: events.sourceId,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
    })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.source, "ai_suggestion"),
        like(events.sourceId, "plan:%"),
        eq(events.status, "scheduled"),
        gte(events.endsAt, now),
      ),
    );
  const plannedByTask: Record<string, number> = {};
  const existingPerDay: Record<string, number> = {};
  for (const b of existingPlanBlocks) {
    if (!b.startsAt || !b.endsAt) continue;
    const mins = Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000);
    const taskId = b.sourceId?.split(":")[2];
    if (taskId) plannedByTask[taskId] = (plannedByTask[taskId] ?? 0) + mins;
    const day = localDayKey(b.startsAt);
    existingPerDay[day] = (existingPerDay[day] ?? 0) + mins;
  }

  // Replan mode also rolls forward: stale planned blocks (time passed,
  // never completed) point back at their tasks via sourceId.
  let staleBlockIds: string[] = [];
  let staleTaskIds: string[] = [];
  if (mode === "today") {
    const stale = await db
      .select({ id: events.id, sourceId: events.sourceId })
      .from(events)
      .where(
        and(
          eq(events.userId, userId),
          eq(events.source, "ai_suggestion"),
          like(events.sourceId, "plan:%"),
          eq(events.status, "scheduled"),
          lt(events.endsAt, now),
        ),
      );
    staleBlockIds = stale.map((s) => s.id);
    staleTaskIds = stale
      .map((s) => s.sourceId?.split(":")[2])
      .filter((x): x is string => Boolean(x));
  }

  const tasks = allTasks.filter(
    (t) =>
      mode === "week" ||
      (t.dueAt && t.dueAt < new Date(now.getTime() + 2 * DAY)) ||
      staleTaskIds.includes(t.id),
  );

  const free = freeByDay(busy, todayIso, horizon, now, prefs);
  const flatFree = free.flatMap((f) => f.blocks);

  // Replanning past-due work: the deadline being behind us must not make
  // placement impossible — the point is doing it NOW.
  const planTasks = tasks.map((t) => ({
    ...t,
    dueAt: t.dueAt && t.dueAt < now ? null : t.dueAt,
    plannedMinutes: plannedByTask[t.id] ?? 0,
  }));

  const result = proposeBlocks({
    tasks: planTasks,
    free: flatFree,
    now,
    focusByHour,
    hourOf: localHourOf,
    dayKeyOf: localDayKey,
    bufferMinutes: prefs.bufferMinutes,
    maxPerDayMinutes: prefs.maxPlanMinutesPerDay,
    existingPerDay,
  });

  // Suggestion surfaces for today (roadmap: best study time, break timing,
  // sleep consistency, movement) — each one-click acceptable.
  const todayFree = free[0]?.blocks ?? [];
  const habitTitles = await db
    .select({ title: events.title })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.kind, "habit"),
        eq(events.status, "scheduled"),
      ),
    );
  const earliestCommitmentHour = busy.length
    ? Math.min(...busy.map((b) => localHourOf(b.startsAt)))
    : null;
  const suggestions: Suggestion[] = buildSuggestions({
    now,
    free: todayFree,
    focusByHour,
    hourOf: localHourOf,
    busy: busy.filter((b) => localDayKey(b.startsAt) === todayIso),
    habitTitles: habitTitles.map((h) => h.title),
    earliestCommitmentHour,
    plannedMinutesToday: existingPerDay[todayIso] ?? 0,
  });

  return {
    mode,
    proposals: result.proposals.map((p) => ({
      taskId: p.taskId,
      taskTitle: p.taskTitle,
      startIso: p.start.toISOString(),
      minutes: p.minutes,
      dayIso: isoDayInTz(p.start, TZ),
    })),
    taskCount: tasks.length,
    unplaceable: result.unplaceable.map((u) => ({
      taskId: u.taskId,
      title: u.title,
      reason: u.reason,
      missingMinutes: u.missingMinutes,
    })),
    truncated: result.truncated,
    suggestions: suggestions.map((s) => ({
      kind: s.kind,
      title: s.title,
      rationale: s.rationale,
      startIso: s.start.toISOString(),
      minutes: s.minutes,
      eventTitle: s.eventTitle,
      categoryName: s.categoryName,
    })),
    prefs,
    warnings: warningsForRange(busy, prefs.bufferMinutes).slice(0, 5),
    overload: overloadDays(tasks, free),
    freeSummary: free.map((f: DayFree) => ({
      dayIso: f.dayIso,
      freeMinutes: f.freeMinutes,
    })),
    focusHint: focusHintFrom(focusByHour),
    staleBlockIds,
  };
}

// ---------------------------------------------------------------------------
// One-click suggestion accept
// ---------------------------------------------------------------------------

const suggestionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  startIso: z.string().datetime(),
  minutes: z.number().int().min(10).max(240),
  categoryName: z.string().max(60).nullable(),
});

export async function acceptSuggestion(
  input: z.infer<typeof suggestionSchema>,
): Promise<{ ok?: boolean; error?: string }> {
  const userId = await requireUserId();
  const parsed = suggestionSchema.safeParse(input);
  if (!parsed.success) return { error: "That suggestion didn't look right." };
  const v = parsed.data;
  const start = new Date(v.startIso);
  const now = new Date();
  if (start < new Date(now.getTime() - 60_000)) {
    return { error: "That window has passed — refresh for a fresh suggestion." };
  }
  const end = new Date(start.getTime() + v.minutes * 60_000);

  // Same freshness guarantee as the planner: don't drop a block onto
  // something that got scheduled since the page rendered.
  const busy = await getBusyBlocks(userId, now, new Date(now.getTime() + 2 * DAY));
  const clashes = busy.some(
    (b) => b.startsAt.getTime() < end.getTime() && start.getTime() < b.endsAt.getTime(),
  );
  if (clashes) {
    return { error: "Something else landed in that slot — refresh to see what's open." };
  }

  let categoryId: string | null = null;
  if (v.categoryName) {
    const cat = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.userId, userId), eq(categories.name, v.categoryName)));
    categoryId = cat[0]?.id ?? null;
  }

  const id = crypto.randomUUID();
  await db.insert(events).values({
    id,
    userId,
    title: v.title,
    kind: "event",
    categoryId,
    startsAt: start,
    endsAt: end,
    allDay: false,
    tz: TZ,
    source: "ai_suggestion",
    sourceId: `suggestion:${id}`,
  });
  await db.insert(activityLog).values({
    id: crypto.randomUUID(),
    userId,
    type: "suggestion_accepted",
    entityType: "event",
    entityId: id,
    data: { title: v.title },
  });
  await syncJobsForEvent(id);
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Accept (the ONE write path) + undo
// ---------------------------------------------------------------------------

const acceptSchema = z.object({
  blocks: z
    .array(
      z.object({
        taskId: z.string().max(100),
        startIso: z.string().datetime(),
        minutes: z.number().int().min(25).max(180),
      }),
    )
    .min(1)
    .max(40),
  /** Replan: stale block ids to sweep (server re-verifies each). */
  sweepBlockIds: z.array(z.string().max(100)).max(60).default([]),
});

export type AcceptResult = {
  ok?: boolean;
  created?: number;
  skipped?: number;
  batchId?: string;
  error?: string;
};

export async function acceptPlan(input: unknown): Promise<AcceptResult> {
  const userId = await requireUserId();
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { error: "That plan didn't look right — regenerate and try again." };
  const v = parsed.data;
  const now = new Date();

  // Ownership + task facts for every referenced task, in one query.
  const taskIds = [...new Set(v.blocks.map((b) => b.taskId))];
  const taskRows = await db
    .select({
      id: events.id,
      title: events.title,
      categoryId: events.categoryId,
      courseId: events.courseId,
    })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.kind, "task"),
        inArray(events.id, taskIds),
      ),
    );
  const taskById = new Map(taskRows.map((t) => [t.id, t]));
  if (taskById.size !== taskIds.length) {
    return { error: "One of those tasks no longer exists." };
  }

  // Fresh collision check — the calendar may have moved since the proposal.
  const horizon = new Date(now.getTime() + 21 * DAY);
  const [busy, acceptPrefs] = await Promise.all([
    getBusyBlocks(userId, now, horizon),
    getSchedulingPrefs(userId),
  ]);
  const openNow = freeBlocks({
    busy,
    windowStart: now,
    windowEnd: horizon,
    // Re-check against the SAME buffer the proposal used — accepting must
    // not quietly place a block flush against a class.
    bufferMinutes: acceptPrefs.bufferMinutes,
    minBlockMinutes: 1,
  });

  const batchId = crypto.randomUUID().slice(0, 8);
  const eventRows: (typeof events.$inferInsert)[] = [];
  const reminderRows: (typeof reminders.$inferInsert)[] = [];
  let skipped = 0;

  for (const b of v.blocks) {
    const start = new Date(b.startIso);
    const end = new Date(start.getTime() + b.minutes * 60_000);
    if (start < new Date(now.getTime() - 60_000) || start > horizon) {
      skipped++;
      continue;
    }
    const fits = openNow.some(
      (f) => f.start.getTime() <= start.getTime() && end.getTime() <= f.end.getTime(),
    );
    if (!fits) {
      skipped++;
      continue;
    }
    const task = taskById.get(b.taskId)!;
    const id = crypto.randomUUID();
    eventRows.push({
      id,
      userId,
      title: `Focus: ${task.title}`,
      description: `Planned work session for “${task.title}”.`,
      kind: "event",
      categoryId: task.categoryId,
      courseId: task.courseId,
      startsAt: start,
      endsAt: end,
      allDay: false,
      tz: TZ,
      source: "ai_suggestion",
      sourceId: `plan:${batchId}:${task.id}`,
    });
    reminderRows.push({
      id: crypto.randomUUID(),
      eventId: id,
      offsetMinutes: 10,
      channels: ["push"],
    });
    // Blocks in this same batch are busy too — no self-overlap.
    const slot = openNow.find(
      (f) => f.start.getTime() <= start.getTime() && end.getTime() <= f.end.getTime(),
    );
    if (slot) {
      const tail = { start: end, end: slot.end, minutes: 0 };
      slot.end = start;
      openNow.push(tail);
    }
  }

  if (eventRows.length === 0) {
    return { error: "The calendar shifted — none of those slots are open anymore. Regenerate the plan." };
  }

  // Replan sweep: verified stale plan blocks only, never arbitrary events.
  const sweepIds =
    v.sweepBlockIds.length > 0
      ? (
          await db
            .select({ id: events.id })
            .from(events)
            .where(
              and(
                eq(events.userId, userId),
                eq(events.source, "ai_suggestion"),
                like(events.sourceId, "plan:%"),
                inArray(events.id, v.sweepBlockIds),
              ),
            )
        ).map((r) => r.id)
      : [];

  type Batchable = Parameters<typeof db.batch>[0][number];
  const statements: Batchable[] = [];
  if (sweepIds.length > 0) {
    statements.push(db.delete(events).where(inArray(events.id, sweepIds)));
  }
  statements.push(db.insert(events).values(eventRows));
  statements.push(db.insert(reminders).values(reminderRows));
  statements.push(
    db.insert(activityLog).values({
      id: crypto.randomUUID(),
      userId,
      type: "week_planned",
      entityType: "plan",
      entityId: batchId,
      data: { blocks: eventRows.length, swept: sweepIds.length },
    }),
  );
  await db.batch(statements as [Batchable, ...Batchable[]]);

  for (const row of eventRows) {
    await syncJobsForEvent(row.id!);
  }

  refresh();
  return { ok: true, created: eventRows.length, skipped, batchId };
}

export async function undoPlan(batchId: string): Promise<void> {
  const userId = await requireUserId();
  const clean = batchId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 16);
  if (!clean) return;
  await db
    .delete(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.source, "ai_suggestion"),
        like(events.sourceId, `plan:${clean}:%`),
      ),
    );
  await db.insert(activityLog).values({
    id: crypto.randomUUID(),
    userId,
    type: "plan_undone",
    entityType: "plan",
    entityId: clean,
    data: {},
  });
  refresh();
}

// ---------------------------------------------------------------------------
// Overdue triage — move, shrink, or drop, one tap each
// ---------------------------------------------------------------------------

const triageSchema = z.object({
  taskId: z.string().max(100),
  action: z.enum(["today", "tomorrow", "weekend", "shrink", "drop"]),
});

function nextDueFor(action: "today" | "tomorrow" | "weekend", now: Date): Date {
  const todayIso = isoDayInTz(now, TZ);
  if (action === "today") {
    const tonight = fromFloating(new Date(`${todayIso}T21:00:00Z`), TZ);
    return tonight > now
      ? tonight
      : new Date(now.getTime() + 2 * 3600_000);
  }
  if (action === "tomorrow") {
    return fromFloating(new Date(`${shiftIso(todayIso, 1)}T17:00:00Z`), TZ);
  }
  // weekend → next Saturday 11:00 (today if Saturday morning)
  const dow = new Date(`${todayIso}T12:00:00Z`).getUTCDay(); // 0=Sun
  let ahead = (6 - dow + 7) % 7;
  const satIso = shiftIso(todayIso, ahead);
  let due = fromFloating(new Date(`${satIso}T11:00:00Z`), TZ);
  if (due <= now) {
    ahead += 7;
    due = fromFloating(new Date(`${shiftIso(todayIso, ahead)}T11:00:00Z`), TZ);
  }
  return due;
}

export async function triageOverdue(
  input: z.infer<typeof triageSchema>,
): Promise<{ ok?: boolean; error?: string }> {
  const userId = await requireUserId();
  const parsed = triageSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid triage action." };
  const { taskId, action } = parsed.data;

  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      estimatedMinutes: events.estimatedMinutes,
      categoryName: sql<string | null>`null`,
    })
    .from(events)
    .where(
      and(eq(events.id, taskId), eq(events.userId, userId), eq(events.kind, "task")),
    );
  const task = rows[0];
  if (!task) return { error: "Task not found." };

  const now = new Date();
  if (action === "drop") {
    await db
      .update(events)
      .set({ status: "cancelled", updatedAt: now })
      .where(eq(events.id, taskId));
    await acknowledgeJobsForEvent(taskId);
  } else if (action === "shrink") {
    const current =
      task.estimatedMinutes ??
      effectiveEstimate({
        id: task.id,
        title: task.title,
        dueAt: null,
        estimatedMinutes: task.estimatedMinutes,
        priority: "normal",
        categoryName: task.categoryName,
      });
    await db
      .update(events)
      .set({
        estimatedMinutes: Math.max(15, Math.round(current / 2)),
        updatedAt: now,
      })
      .where(eq(events.id, taskId));
  } else {
    await db
      .update(events)
      .set({ dueAt: nextDueFor(action, now), updatedAt: now })
      .where(eq(events.id, taskId));
  }

  await syncJobsForEvent(taskId);
  await db.insert(activityLog).values({
    id: crypto.randomUUID(),
    userId,
    type: "task_triaged",
    entityType: "event",
    entityId: taskId,
    data: { action, title: task.title },
  });
  refresh();
  return { ok: true };
}
