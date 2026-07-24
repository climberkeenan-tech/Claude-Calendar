/**
 * Nightly rollups into daily_stats (ARCHITECTURE §8). Charts read this
 * table, never raw rows — the analytics page stays instant regardless of
 * history size. The math lives in rollup-core.ts (pure, fixture-tested);
 * this file only gathers inputs and persists results.
 */
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  categories,
  dailyStats,
  events,
  focusSessions,
} from "@/lib/db/schema";
import { getCalendarWindow } from "@/lib/db/queries/calendar";
import { fromFloating, isoDayInTz } from "@/lib/tz";
import {
  computeDayStats,
  WAKE_END,
  WAKE_START,
  type DayStatsInput,
  type DayStatsRow,
} from "./rollup-core";

const TZ = "America/New_York";

function localDayBounds(dayIso: string) {
  const nextIso = new Date(
    new Date(`${dayIso}T12:00:00Z`).getTime() + 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);
  return {
    dayStart: fromFloating(new Date(`${dayIso}T00:00:00Z`), TZ),
    dayEnd: fromFloating(new Date(`${nextIso}T00:00:00Z`), TZ),
    wakeStart: fromFloating(new Date(`${dayIso}T${WAKE_START}Z`), TZ),
    wakeEnd: fromFloating(new Date(`${dayIso}T${WAKE_END}Z`), TZ),
  };
}

const KIND_LABEL: Record<string, string> = {
  study: "Study",
  work: "Work",
  reading: "Reading",
  other: "Other",
};

export async function gatherDayInputs(
  userId: string,
  dayIso: string,
): Promise<DayStatsInput> {
  const bounds = localDayBounds(dayIso);

  const [focus, completed, due, blocks] = await Promise.all([
    db
      .select({
        startedAt: focusSessions.startedAt,
        durationMinutes: focusSessions.durationMinutes,
        kind: focusSessions.kind,
        categoryName: categories.name,
      })
      .from(focusSessions)
      .leftJoin(events, eq(focusSessions.eventId, events.id))
      .leftJoin(categories, eq(events.categoryId, categories.id))
      .where(
        and(
          eq(focusSessions.userId, userId),
          gte(focusSessions.startedAt, bounds.dayStart),
          lt(focusSessions.startedAt, bounds.dayEnd),
        ),
      ),
    db
      .select({ completedAt: events.completedAt, dueAt: events.dueAt })
      .from(events)
      .where(
        and(
          eq(events.userId, userId),
          eq(events.kind, "task"),
          gte(events.completedAt, bounds.dayStart),
          lt(events.completedAt, bounds.dayEnd),
        ),
      ),
    db
      .select({ dueAt: events.dueAt, completedAt: events.completedAt })
      .from(events)
      .where(
        and(
          eq(events.userId, userId),
          eq(events.kind, "task"),
          gte(events.dueAt, bounds.dayStart),
          lt(events.dueAt, bounds.dayEnd),
        ),
      ),
    getCalendarWindow(userId, bounds.dayStart, bounds.dayEnd),
  ]);

  return {
    ...bounds,
    focus: focus.map((f) => ({
      startedAt: f.startedAt,
      durationMinutes: f.durationMinutes,
      label: f.categoryName ?? KIND_LABEL[f.kind] ?? "Other",
    })),
    completed: completed.filter(
      (c): c is { completedAt: Date; dueAt: Date | null } =>
        c.completedAt !== null,
    ),
    due: due.filter(
      (d): d is { dueAt: Date; completedAt: Date | null } => d.dueAt !== null,
    ),
    busy: blocks
      .filter(
        (b) =>
          b.kind === "event" &&
          !b.allDay &&
          b.startsAt !== null &&
          b.endsAt !== null,
      )
      .map((b) => ({ startsAt: b.startsAt!, endsAt: b.endsAt! })),
  };
}

/** Compute (without persisting) one day's stats — used live for "today".
 * Passes "now" so deadlines later today aren't counted as missed yet. */
export async function computeDayLive(
  userId: string,
  dayIso: string,
): Promise<DayStatsRow> {
  return computeDayStats(await gatherDayInputs(userId, dayIso), new Date());
}

/**
 * Nightly (and lazy first-visit) rollup: recompute yesterday, and backfill
 * any missing days in the window. Idempotent upserts — safe to re-run.
 */
export async function rollupUser(
  userId: string,
  opts: { backfillDays?: number } = {},
): Promise<number> {
  const backfillDays = opts.backfillDays ?? 60;
  const todayIso = isoDayInTz(new Date(), TZ);

  const dayList: string[] = [];
  for (let i = 1; i <= backfillDays; i++) {
    dayList.push(
      new Date(new Date(`${todayIso}T12:00:00Z`).getTime() - i * 86_400_000)
        .toISOString()
        .slice(0, 10),
    );
  }

  const existing = await db
    .select({ day: dailyStats.day })
    .from(dailyStats)
    .where(and(eq(dailyStats.userId, userId), inArray(dailyStats.day, dayList)));
  const have = new Set(existing.map((e) => e.day));

  // Yesterday always recomputes (it was partial at last night's run);
  // older days only fill gaps.
  const toCompute = dayList.filter((d, idx) => idx === 0 || !have.has(d));

  for (const dayIso of toCompute) {
    const row = computeDayStats(await gatherDayInputs(userId, dayIso));
    await db
      .insert(dailyStats)
      .values({ userId, day: dayIso, ...row })
      .onConflictDoUpdate({
        target: [dailyStats.userId, dailyStats.day],
        set: { ...row },
      });
  }
  return toCompute.length;
}

/** True when the user has no row for yesterday — the page uses this to
 * lazily backfill after a fresh deploy instead of showing an empty page. */
export async function needsRollup(userId: string): Promise<boolean> {
  const todayIso = isoDayInTz(new Date(), TZ);
  const yesterday = new Date(
    new Date(`${todayIso}T12:00:00Z`).getTime() - 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const rows = await db
    .select({ day: dailyStats.day })
    .from(dailyStats)
    .where(and(eq(dailyStats.userId, userId), eq(dailyStats.day, yesterday)));
  return rows.length === 0;
}
