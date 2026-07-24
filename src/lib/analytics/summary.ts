/**
 * Analytics assembly — everything the analytics page, the dashboard score
 * tile, and the MCP productivity summary read. One shared core so the
 * number Claude quotes is the number the page shows.
 */
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  categories,
  courses,
  dailyStats,
  events,
  focusSessions,
  userSettings,
} from "@/lib/db/schema";
import { getHabitsWeek } from "@/lib/db/queries/calendar";
import { fromFloating, isoDayInTz } from "@/lib/tz";
import { computeDayLive, needsRollup, rollupUser } from "./rollup";
import type { DayStatsRow } from "./rollup-core";
import {
  weeklyScore,
  winsAndNextAction,
  type ScorePart,
  type WeekScoreInput,
} from "./score";

const TZ = "America/New_York";
const DAY = 86_400_000;

const shiftIso = (dayIso: string, days: number) =>
  new Date(new Date(`${dayIso}T12:00:00Z`).getTime() + days * DAY)
    .toISOString()
    .slice(0, 10);

/** Monday-start week (same convention as the dashboard). */
function weekDaysOf(dayIso: string): string[] {
  const dow = (new Date(`${dayIso}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monday = shiftIso(dayIso, -dow);
  return Array.from({ length: 7 }, (_, i) => shiftIso(monday, i));
}

type DayRecord = DayStatsRow & { day: string };

const EMPTY: DayStatsRow = {
  minutesStudied: 0,
  minutesByCategory: {},
  freeMinutes: 0,
  avgWorkSessionMinutes: null,
  tasksCompleted: 0,
  tasksCompletedLate: 0,
  tasksOverdue: 0,
  focusSessionCount: 0,
};

export type ScoreView = {
  visible: boolean;
  score: number | null;
  parts: ScorePart[];
  wins: string[];
  nextAction: string;
};

export type AnalyticsData = {
  todayIso: string;
  kpis: {
    focusMinutesWeek: number;
    focusMinutesLastWeek: number;
    tasksDoneWeek: number;
    onTimeRate: number | null; // 0-1, null = nothing due/done
    habitsMet: number;
    habitsTotal: number;
  };
  score: ScoreView;
  /** Last 14 days, oldest first. */
  timeline: { day: string; minutes: number; tasks: number }[];
  /** Last 8 ISO weeks (oldest first). */
  trends: { weekOf: string; focusMinutes: number; tasksCompleted: number }[];
  /** 12 week columns × 7 weekday rows, for the productive-days heatmap. */
  heatmap: {
    day: string;
    /** 0=Mon … 6=Sun */
    weekday: number;
    minutes: number;
    tasks: number;
    /** 0–4 ramp bin (0 = no activity). */
    bin: number;
  }[];
  categories30: { name: string; minutes: number; color: string | null }[];
  courses30: { name: string; minutes: number; sessions: number; color: string | null }[];
  semester: { startIso: string; endIso: string; pct: number } | null;
  avgSessionMinutes30: number | null;
  freeMinutesAvg7: number | null;
};

/** Fixed, explainable heatmap bins ("activity" = focus minutes + 25 per
 * completed task — a task without the timer still counts as a real chunk). */
export function heatBin(minutes: number, tasks: number): number {
  const activity = minutes + tasks * 25;
  if (activity <= 0) return 0;
  if (activity <= 30) return 1;
  if (activity <= 75) return 2;
  if (activity <= 150) return 3;
  return 4;
}

async function loadDays(
  userId: string,
  fromIso: string,
  toIsoExclusive: string,
): Promise<Map<string, DayRecord>> {
  const rows = await db
    .select()
    .from(dailyStats)
    .where(
      and(
        eq(dailyStats.userId, userId),
        gte(dailyStats.day, fromIso),
        lt(dailyStats.day, toIsoExclusive),
      ),
    );
  return new Map(
    rows.map((r) => [
      r.day,
      {
        day: r.day,
        minutesStudied: r.minutesStudied,
        minutesByCategory: r.minutesByCategory ?? {},
        freeMinutes: r.freeMinutes,
        avgWorkSessionMinutes: r.avgWorkSessionMinutes,
        tasksCompleted: r.tasksCompleted,
        tasksCompletedLate: r.tasksCompletedLate,
        tasksOverdue: r.tasksOverdue,
        focusSessionCount: r.focusSessionCount,
      },
    ]),
  );
}

async function buildWeekScoreInput(
  userId: string,
  todayIso: string,
  days: Map<string, DayRecord>,
  todayLive: DayStatsRow,
): Promise<{ input: WeekScoreInput; habits: { done: number; target: number }[] }> {
  const week = weekDaysOf(todayIso);
  const weekStart = fromFloating(new Date(`${week[0]}T00:00:00Z`), TZ);
  const weekEnd = fromFloating(
    new Date(`${shiftIso(week[6], 1)}T00:00:00Z`),
    TZ,
  );

  const get = (iso: string): DayStatsRow =>
    iso === todayIso ? todayLive : (days.get(iso) ?? EMPTY);
  const past = week.filter((d) => d <= todayIso);
  const sum = (f: (r: DayStatsRow) => number) =>
    past.reduce((a, d) => a + f(get(d)), 0);

  const now = new Date();
  const windowEnd = fromFloating(
    new Date(`${shiftIso(todayIso, 1)}T00:00:00Z`),
    TZ,
  );
  const [habitRows, overdueRows, anyTask, lateAfterDueDay] = await Promise.all([
    getHabitsWeek(userId, weekStart, weekEnd),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(events)
      .where(
        and(
          eq(events.userId, userId),
          eq(events.kind, "task"),
          eq(events.status, "scheduled"),
          lt(events.dueAt, now),
        ),
      ),
    db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.userId, userId), eq(events.kind, "task")))
      .limit(1),
    // Tasks that BOTH came due and were completed (on a later local day)
    // inside this week's summed window. Each shows up twice in the day rows
    // — as its due day's "missed" AND its completion day's "late" — and
    // must count once in the on-time denominator, or finishing an overdue
    // task would score WORSE than abandoning it.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(events)
      .where(
        and(
          eq(events.userId, userId),
          eq(events.kind, "task"),
          gte(events.dueAt, weekStart),
          lt(events.dueAt, windowEnd),
          gte(events.completedAt, weekStart),
          lt(events.completedAt, windowEnd),
          sql`(${events.completedAt} at time zone ${TZ})::date > (${events.dueAt} at time zone ${TZ})::date`,
        ),
      ),
  ]);

  const settingsRows = await db
    .select({
      target: userSettings.focusTargetMinutesPerDay,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));

  const habits = habitRows.map((h) => ({
    done: h.doneDates.length,
    target: h.target,
  }));

  return {
    habits,
    input: {
      tasksCompleted: sum((r) => r.tasksCompleted),
      tasksCompletedLate: sum((r) => r.tasksCompletedLate),
      tasksMissed: Math.max(
        0,
        sum((r) => r.tasksOverdue) - (lateAfterDueDay[0]?.n ?? 0),
      ),
      focusMinutes: sum((r) => r.minutesStudied),
      focusTargetMinutesPerDay: settingsRows[0]?.target ?? null,
      habits,
      openOverdueNow: overdueRows[0]?.n ?? 0,
      usesTasks: anyTask.length > 0,
      daysElapsed: past.length,
    },
  };
}

/** Shared by the dashboard tile and the MCP summary tool. */
export async function getWeekScore(userId: string): Promise<ScoreView> {
  const todayIso = isoDayInTz(new Date(), TZ);
  const week = weekDaysOf(todayIso);
  const [days, todayLive, settingsRows] = await Promise.all([
    loadDays(userId, week[0], shiftIso(week[6], 1)),
    computeDayLive(userId, todayIso),
    db
      .select({ show: userSettings.showProductivityScore })
      .from(userSettings)
      .where(eq(userSettings.userId, userId)),
  ]);
  const { input } = await buildWeekScoreInput(userId, todayIso, days, todayLive);
  const { score, parts } = weeklyScore(input);
  const { wins, nextAction } = winsAndNextAction(input, parts);
  return {
    visible: settingsRows[0]?.show ?? true,
    score,
    parts,
    wins,
    nextAction,
  };
}

export async function assembleAnalytics(userId: string): Promise<AnalyticsData> {
  // First visit after a deploy (or a long-slept cron): fill the table so the
  // page never opens empty. Capped small — the nightly job does the rest.
  if (await needsRollup(userId)) {
    await rollupUser(userId, { backfillDays: 14 });
  }

  const todayIso = isoDayInTz(new Date(), TZ);
  const week = weekDaysOf(todayIso);
  // 12 heatmap weeks end with the current week.
  const heatStart = shiftIso(week[0], -77);
  const rangeStart = shiftIso(todayIso, -90);

  const [days, todayLive, settingsRows, cats] = await Promise.all([
    loadDays(userId, rangeStart, shiftIso(todayIso, 1)),
    computeDayLive(userId, todayIso),
    db
      .select({
        show: userSettings.showProductivityScore,
      })
      .from(userSettings)
      .where(eq(userSettings.userId, userId)),
    db
      .select({ name: categories.name, color: categories.color })
      .from(categories)
      .where(eq(categories.userId, userId)),
  ]);

  const get = (iso: string): DayStatsRow =>
    iso === todayIso ? todayLive : (days.get(iso) ?? EMPTY);

  // Score + wins
  const { input, habits } = await buildWeekScoreInput(
    userId,
    todayIso,
    days,
    todayLive,
  );
  const { score, parts } = weeklyScore(input);
  const { wins, nextAction } = winsAndNextAction(input, parts);

  // KPIs
  const lastWeek = weekDaysOf(shiftIso(week[0], -1));
  const sumOver = (isoDays: string[], f: (r: DayStatsRow) => number) =>
    isoDays.filter((d) => d <= todayIso).reduce((a, d) => a + f(get(d)), 0);
  const denom = input.tasksCompleted + input.tasksMissed;
  // Like-for-like delta: partial week vs the SAME number of days last week.
  const lastWeekSamePoint = lastWeek.slice(0, input.daysElapsed);

  // Timeline — last 14 days
  const timeline = Array.from({ length: 14 }, (_, i) => {
    const day = shiftIso(todayIso, i - 13);
    const r = get(day);
    return { day, minutes: r.minutesStudied, tasks: r.tasksCompleted };
  });

  // Trends — 8 ISO weeks, oldest first
  const trends = Array.from({ length: 8 }, (_, i) => {
    const monday = shiftIso(week[0], (i - 7) * 7);
    const isoDays = Array.from({ length: 7 }, (_, j) => shiftIso(monday, j));
    return {
      weekOf: monday,
      focusMinutes: sumOver(isoDays, (r) => r.minutesStudied),
      tasksCompleted: sumOver(isoDays, (r) => r.tasksCompleted),
    };
  });

  // Heatmap — 12 weeks × 7 days
  const heatmap: AnalyticsData["heatmap"] = [];
  for (let i = 0; i < 84; i++) {
    const day = shiftIso(heatStart, i);
    if (day > todayIso) break;
    const r = get(day);
    heatmap.push({
      day,
      weekday: i % 7,
      minutes: r.minutesStudied,
      tasks: r.tasksCompleted,
      bin: heatBin(r.minutesStudied, r.tasksCompleted),
    });
  }

  // Category minutes — last 30 days, entity colors, tail folded into Other
  const catColor = new Map(cats.map((c) => [c.name, c.color]));
  const catTotals = new Map<string, number>();
  for (let i = 0; i < 30; i++) {
    const r = get(shiftIso(todayIso, -i));
    for (const [name, mins] of Object.entries(r.minutesByCategory)) {
      catTotals.set(name, (catTotals.get(name) ?? 0) + mins);
    }
  }
  const sortedCats = [...catTotals.entries()]
    .map(([name, minutes]) => ({
      name,
      minutes,
      color: catColor.get(name) ?? null,
    }))
    .sort((a, b) => b.minutes - a.minutes);
  const categories30 =
    sortedCats.length <= 6
      ? sortedCats
      : [
          ...sortedCats.slice(0, 5),
          {
            name: "Other",
            minutes: sortedCats.slice(5).reduce((a, c) => a + c.minutes, 0),
            color: null,
          },
        ];

  // Course workload — last 30 days of focus, live (small, indexed)
  const since30 = new Date(Date.now() - 30 * DAY);
  const courseRows = await db
    .select({
      name: sql<string>`coalesce(${courses.name}, 'No course')`,
      color: sql<string | null>`max(${courses.color})`,
      minutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}), 0)::int`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(focusSessions)
    .leftJoin(courses, eq(focusSessions.courseId, courses.id))
    .where(
      and(eq(focusSessions.userId, userId), gte(focusSessions.startedAt, since30)),
    )
    .groupBy(sql`1`);
  const courses30 = courseRows
    .filter((c) => c.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 8);

  // Semester window — inferred from the span of scheduled work
  const now = new Date();
  // Epochs, not timestamps — driver-agnostic (string vs Date parsing).
  const spanRows = await db
    .select({
      min: sql<number | null>`extract(epoch from min(least(coalesce(${events.startsAt}, ${events.dueAt}), coalesce(${events.dueAt}, ${events.startsAt}))))::double precision`,
      max: sql<number | null>`extract(epoch from max(greatest(coalesce(${events.endsAt}, ${events.dueAt}, ${events.startsAt}), coalesce(${events.dueAt}, ${events.startsAt}))))::double precision`,
    })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        inArray(events.kind, ["event", "task"]),
        gte(
          sql`coalesce(${events.startsAt}, ${events.dueAt})`,
          new Date(now.getTime() - 160 * DAY),
        ),
      ),
    );
  let semester: AnalyticsData["semester"] = null;
  const sMin = spanRows[0]?.min ? new Date(spanRows[0].min * 1000) : null;
  const sMax = spanRows[0]?.max ? new Date(spanRows[0].max * 1000) : null;
  if (
    sMin &&
    sMax &&
    sMax.getTime() - sMin.getTime() >= 45 * DAY &&
    sMax > now &&
    sMin < now
  ) {
    semester = {
      startIso: isoDayInTz(sMin, TZ),
      endIso: isoDayInTz(sMax, TZ),
      pct: Math.round(
        ((now.getTime() - sMin.getTime()) / (sMax.getTime() - sMin.getTime())) *
          100,
      ),
    };
  }

  // Average session — straight from finished sessions (the day rows'
  // focusSessionCount includes running/zero-minute sessions, which would
  // silently deflate the average).
  const avgRows = await db
    .select({
      minutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}), 0)::int`,
      n: sql<number>`count(*)::int`,
    })
    .from(focusSessions)
    .where(
      and(
        eq(focusSessions.userId, userId),
        gte(focusSessions.startedAt, since30),
        sql`${focusSessions.durationMinutes} > 0`,
      ),
    );
  const sessTotal = avgRows[0]?.n ?? 0;
  const minTotal = avgRows[0]?.minutes ?? 0;
  const free7 = Array.from({ length: 7 }, (_, i) =>
    get(shiftIso(todayIso, -(i + 1))),
  ).map((r) => r.freeMinutes);
  const freeKnown = free7.filter((n) => n > 0);

  return {
    todayIso,
    kpis: {
      focusMinutesWeek: input.focusMinutes,
      focusMinutesLastWeek: sumOver(lastWeekSamePoint, (r) => r.minutesStudied),
      tasksDoneWeek: input.tasksCompleted,
      onTimeRate:
        denom > 0
          ? Math.max(0, input.tasksCompleted - input.tasksCompletedLate) / denom
          : null,
      habitsMet: habits.filter((h) => h.done >= Math.max(1, h.target)).length,
      habitsTotal: habits.length,
    },
    score: {
      visible: settingsRows[0]?.show ?? true,
      score,
      parts,
      wins,
      nextAction,
    },
    timeline,
    trends,
    heatmap,
    categories30,
    courses30,
    semester,
    avgSessionMinutes30: sessTotal > 0 ? Math.round(minTotal / sessTotal) : null,
    freeMinutesAvg7:
      freeKnown.length > 0
        ? Math.round(freeKnown.reduce((a, b) => a + b, 0) / freeKnown.length)
        : null,
  };
}
