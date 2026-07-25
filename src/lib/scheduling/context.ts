/**
 * Scheduling context — the I/O layer feeding the pure free-time and plan
 * cores. Shared by the /plan page, replan, and the MCP get_free_time tool.
 */
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { categories, events, userPatterns, userSettings } from "@/lib/db/schema";
import { getCalendarWindow } from "@/lib/db/queries/calendar";
import { fromFloating, isoDayInTz } from "@/lib/tz";
import type { UserPatterns } from "@/lib/analytics/patterns";
import {
  adjacencyWarnings,
  freeBlocks,
  overloadRatio,
  type BusyBlock,
  type FreeBlock,
} from "./free-time";
import { effectiveEstimate, type PlanTask } from "./plan";

const TZ = "America/New_York";
const DAY = 86_400_000;

export const localHourOf = (d: Date): number =>
  Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "numeric",
      hour12: false,
    }).format(d),
  ) % 24;

export const shiftIso = (dayIso: string, days: number): string =>
  new Date(new Date(`${dayIso}T12:00:00Z`).getTime() + days * DAY)
    .toISOString()
    .slice(0, 10);

/** Scheduling preferences — configurable per the roadmap, with the same
 * defaults the schema carries. */
export type SchedulingPrefs = {
  bufferMinutes: number;
  dayStart: string; // "HH:MM"
  dayEnd: string;
  maxPlanMinutesPerDay: number;
};

export const DEFAULT_PREFS: SchedulingPrefs = {
  bufferMinutes: 15,
  dayStart: "08:00",
  dayEnd: "22:00",
  maxPlanMinutesPerDay: 240,
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function getSchedulingPrefs(
  userId: string,
): Promise<SchedulingPrefs> {
  const rows = await db
    .select({
      bufferMinutes: userSettings.transitionBufferMinutes,
      dayStart: userSettings.dayStart,
      dayEnd: userSettings.dayEnd,
      maxPlanMinutesPerDay: userSettings.maxPlanMinutesPerDay,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  const r = rows[0];
  if (!r) return DEFAULT_PREFS;
  // Defend the engine against a hand-edited row: a malformed window would
  // silently produce zero free time.
  const start = HHMM.test(r.dayStart) ? r.dayStart : DEFAULT_PREFS.dayStart;
  const end = HHMM.test(r.dayEnd) ? r.dayEnd : DEFAULT_PREFS.dayEnd;
  return {
    bufferMinutes: Math.min(60, Math.max(0, r.bufferMinutes)),
    dayStart: end > start ? start : DEFAULT_PREFS.dayStart,
    dayEnd: end > start ? end : DEFAULT_PREFS.dayEnd,
    maxPlanMinutesPerDay: Math.min(720, Math.max(30, r.maxPlanMinutesPerDay)),
  };
}

export function wakeWindow(
  dayIso: string,
  prefs: SchedulingPrefs = DEFAULT_PREFS,
): { start: Date; end: Date } {
  return {
    start: fromFloating(new Date(`${dayIso}T${prefs.dayStart}:00Z`), TZ),
    end: fromFloating(new Date(`${dayIso}T${prefs.dayEnd}:00Z`), TZ),
  };
}

/** Timed commitments (events + timed habits, recurring pre-expanded) in a
 * range — the "busy" input everywhere. */
export async function getBusyBlocks(
  userId: string,
  start: Date,
  end: Date,
): Promise<BusyBlock[]> {
  const items = await getCalendarWindow(userId, start, end);
  return items
    .filter(
      (i) =>
        i.kind !== "task" &&
        !i.allDay &&
        i.startsAt !== null &&
        i.endsAt !== null &&
        !i.completed,
    )
    .map((i) => ({
      startsAt: i.startsAt!,
      endsAt: i.endsAt!,
      title: i.title,
      location: i.location,
    }));
}

export type DayFree = {
  dayIso: string;
  blocks: FreeBlock[];
  freeMinutes: number;
};

/** Free blocks per local day, waking hours only, buffers applied. */
export function freeByDay(
  busy: BusyBlock[],
  startDayIso: string,
  dayCount: number,
  now: Date,
  prefs: SchedulingPrefs = DEFAULT_PREFS,
): DayFree[] {
  const out: DayFree[] = [];
  for (let i = 0; i < dayCount; i++) {
    const dayIso = shiftIso(startDayIso, i);
    const win = wakeWindow(dayIso, prefs);
    const windowStart = win.start.getTime() < now.getTime() ? now : win.start;
    if (win.end <= windowStart) {
      out.push({ dayIso, blocks: [], freeMinutes: 0 });
      continue;
    }
    const blocks = freeBlocks({
      busy,
      windowStart,
      windowEnd: win.end,
      bufferMinutes: prefs.bufferMinutes,
    });
    out.push({
      dayIso,
      blocks,
      freeMinutes: blocks.reduce((a, b) => a + b.minutes, 0),
    });
  }
  return out;
}

/** Open dated tasks in the planning horizon (overdue included). */
export async function getPlanTasks(
  userId: string,
  horizonDays: number,
): Promise<PlanTask[]> {
  const now = new Date();
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      dueAt: events.dueAt,
      estimatedMinutes: events.estimatedMinutes,
      priority: events.priority,
      categoryName: categories.name,
      categoryId: events.categoryId,
      courseId: events.courseId,
    })
    .from(events)
    .leftJoin(categories, eq(events.categoryId, categories.id))
    .where(
      and(
        eq(events.userId, userId),
        eq(events.kind, "task"),
        eq(events.status, "scheduled"),
        isNotNull(events.dueAt),
        lt(events.dueAt, new Date(now.getTime() + horizonDays * DAY)),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    dueAt: r.dueAt,
    estimatedMinutes: r.estimatedMinutes,
    priority: r.priority,
    categoryName: r.categoryName,
  }));
}

export async function getFocusByHour(userId: string): Promise<number[] | null> {
  const rows = await db
    .select({ patterns: userPatterns.patterns })
    .from(userPatterns)
    .where(eq(userPatterns.userId, userId));
  const p = rows[0]?.patterns as UserPatterns | undefined;
  return p?.focusByHour ?? null;
}

export type OverloadDay = { dayIso: string; taskMinutes: number; freeMinutes: number };

/** Days where the work DUE that day plainly exceeds the time available. */
export function overloadDays(
  tasks: PlanTask[],
  free: DayFree[],
): OverloadDay[] {
  const byDay = new Map<string, number>();
  for (const t of tasks) {
    if (!t.dueAt) continue;
    const dayIso = isoDayInTz(t.dueAt, TZ);
    byDay.set(dayIso, (byDay.get(dayIso) ?? 0) + effectiveEstimate(t));
  }
  const out: OverloadDay[] = [];
  for (const f of free) {
    const taskMinutes = byDay.get(f.dayIso) ?? 0;
    const ratio = overloadRatio(taskMinutes, f.freeMinutes);
    if (ratio !== null && ratio > 1) {
      out.push({ dayIso: f.dayIso, taskMinutes, freeMinutes: f.freeMinutes });
    }
  }
  return out;
}

export type WarningsByDay = ReturnType<typeof adjacencyWarnings>;

export function warningsForRange(
  busy: BusyBlock[],
  bufferMinutes: number = DEFAULT_PREFS.bufferMinutes,
): WarningsByDay {
  return adjacencyWarnings(busy, bufferMinutes);
}

/** Local day key (America/New_York) — day caps and spreading key on this. */
export const localDayKey = (d: Date): string => isoDayInTz(d, TZ);
