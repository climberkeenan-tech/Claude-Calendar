import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activityLog, categories, events } from "@/lib/db/schema";
import { dayBounds } from "@/lib/time";
import {
  getCalendarWindow,
  getHabitsWeek,
  type CalendarItem,
} from "@/lib/db/queries/calendar";

const DAY = 24 * 60 * 60 * 1000;

export type HabitWeek = {
  id: string;
  title: string;
  target: number;
  doneDates: string[];
  categoryColor: string | null;
};

export type DashboardData = {
  now: Date;
  today: CalendarItem[];
  deadlines: CalendarItem[];
  inbox: { id: string; title: string }[];
  habits: HabitWeek[];
  activity: {
    id: string;
    type: string;
    data: Record<string, unknown> | null;
    createdAt: Date;
  }[];
  categories: { id: string; name: string; color: string }[];
  monthDots: Record<string, number>;
  current: CalendarItem | null;
  next: CalendarItem | null;
  weekStartIso: string;
};

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const now = new Date();
  const { start: dayStart, end: dayEnd, isoDay } = dayBounds(now);
  // Monday-start week (local)
  const dow = (new Date(`${isoDay}T12:00:00Z`).getUTCDay() + 6) % 7;
  const weekStart = new Date(dayStart.getTime() - dow * DAY);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY);

  const windowStart = new Date(dayStart.getTime() - 31 * DAY);
  const windowEnd = new Date(dayStart.getTime() + 62 * DAY);

  const [windowItems, habits, inboxRows, activity, cats] = await Promise.all([
    getCalendarWindow(userId, windowStart, windowEnd),
    getHabitsWeek(userId, weekStart, weekEnd),
    db
      .select({ id: events.id, title: events.title })
      .from(events)
      .where(
        and(
          eq(events.userId, userId),
          eq(events.kind, "task"),
          eq(events.status, "scheduled"),
          isNull(events.dueAt),
        ),
      )
      .orderBy(desc(events.createdAt))
      .limit(12),
    db
      .select({
        id: activityLog.id,
        type: activityLog.type,
        data: activityLog.data,
        createdAt: activityLog.createdAt,
      })
      .from(activityLog)
      .where(eq(activityLog.userId, userId))
      .orderBy(desc(activityLog.createdAt))
      .limit(8),
    db
      .select({ id: categories.id, name: categories.name, color: categories.color })
      .from(categories)
      .where(eq(categories.userId, userId))
      .orderBy(asc(categories.position)),
  ]);

  const today = windowItems.filter((i) => {
    if (!i.startsAt) return false;
    return i.startsAt >= dayStart && i.startsAt < dayEnd;
  });

  const horizon = new Date(now.getTime() + 14 * DAY);
  const deadlines = windowItems
    .filter(
      (i) =>
        i.kind === "task" &&
        !i.completed &&
        i.dueAt &&
        i.dueAt < horizon,
    )
    .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime())
    .slice(0, 8);

  // NOW / NEXT
  const timed = today.filter((i) => !i.allDay && i.startsAt && i.endsAt && !i.completed);
  const current =
    timed.find(
      (i) => i.startsAt!.getTime() <= now.getTime() && now.getTime() < i.endsAt!.getTime(),
    ) ?? null;
  const upcomingToday = timed.find((i) => i.startsAt!.getTime() > now.getTime()) ?? null;
  const dueToday =
    deadlines.find(
      (d) => d.dueAt && d.dueAt.getTime() > now.getTime() && d.dueAt.getTime() < dayEnd.getTime(),
    ) ?? null;
  let next: CalendarItem | null = upcomingToday;
  if (dueToday && (!next || dueToday.dueAt!.getTime() < next.startsAt!.getTime())) {
    next = dueToday;
  }
  if (!next) next = deadlines.find((d) => d.dueAt && d.dueAt > now) ?? null;

  const monthDots: Record<string, number> = {};
  for (const i of windowItems) {
    const anchor = i.startsAt ?? i.dueAt;
    if (!anchor) continue;
    const iso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
    }).format(anchor);
    monthDots[iso] = (monthDots[iso] ?? 0) + 1;
  }

  return {
    now,
    today,
    deadlines,
    inbox: inboxRows,
    habits,
    activity,
    categories: cats,
    monthDots,
    current,
    next,
    weekStartIso: weekStart.toISOString(),
  };
}

export async function getCategories(userId: string) {
  return db
    .select({ id: categories.id, name: categories.name, color: categories.color })
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(asc(categories.position));
}
