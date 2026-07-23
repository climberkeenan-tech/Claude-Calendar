import { and, asc, desc, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activityLog, categories, events } from "@/lib/db/schema";
import { dayBounds } from "@/lib/time";

export type DashboardEvent = {
  id: string;
  title: string;
  kind: "event" | "task" | "habit";
  startsAt: Date | null;
  endsAt: Date | null;
  dueAt: Date | null;
  allDay: boolean;
  location: string | null;
  categoryName: string | null;
  categoryColor: string | null;
};

export type DashboardData = {
  now: Date;
  today: DashboardEvent[];
  deadlines: DashboardEvent[];
  openTasks: DashboardEvent[];
  activity: { id: string; type: string; data: Record<string, unknown> | null; createdAt: Date }[];
  categories: { id: string; name: string; color: string }[];
  monthDots: Record<string, number>;
  current: DashboardEvent | null;
  next: DashboardEvent | null;
};

const eventShape = {
  id: events.id,
  title: events.title,
  kind: events.kind,
  startsAt: events.startsAt,
  endsAt: events.endsAt,
  dueAt: events.dueAt,
  allDay: events.allDay,
  location: events.location,
  categoryName: categories.name,
  categoryColor: categories.color,
};

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const now = new Date();
  const { start, end } = dayBounds(now);
  const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
  const monthEnd = new Date(now.getTime() + 62 * 24 * 60 * 60 * 1000);

  const [today, deadlines, openTasks, activity, cats, dotRows] =
    await Promise.all([
      db
        .select(eventShape)
        .from(events)
        .leftJoin(categories, eq(events.categoryId, categories.id))
        .where(
          and(
            eq(events.userId, userId),
            ne(events.status, "cancelled"),
            isNotNull(events.startsAt),
            gte(events.startsAt, start),
            lt(events.startsAt, end),
          ),
        )
        .orderBy(asc(events.startsAt)),
      db
        .select(eventShape)
        .from(events)
        .leftJoin(categories, eq(events.categoryId, categories.id))
        .where(
          and(
            eq(events.userId, userId),
            eq(events.kind, "task"),
            eq(events.status, "scheduled"),
            isNotNull(events.dueAt),
            lt(events.dueAt, horizon),
          ),
        )
        .orderBy(asc(events.dueAt))
        .limit(8),
      db
        .select(eventShape)
        .from(events)
        .leftJoin(categories, eq(events.categoryId, categories.id))
        .where(
          and(
            eq(events.userId, userId),
            eq(events.kind, "task"),
            eq(events.status, "scheduled"),
          ),
        )
        .orderBy(asc(events.dueAt))
        .limit(10),
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
        .select({
          id: categories.id,
          name: categories.name,
          color: categories.color,
        })
        .from(categories)
        .where(eq(categories.userId, userId))
        .orderBy(asc(categories.position)),
      db
        .select({
          day: sql<string>`to_char(${events.startsAt} at time zone 'America/New_York', 'YYYY-MM-DD')`,
          n: sql<number>`count(*)::int`,
        })
        .from(events)
        .where(
          and(
            eq(events.userId, userId),
            ne(events.status, "cancelled"),
            isNotNull(events.startsAt),
            gte(events.startsAt, monthStart),
            lt(events.startsAt, monthEnd),
          ),
        )
        .groupBy(
          sql`to_char(${events.startsAt} at time zone 'America/New_York', 'YYYY-MM-DD')`,
        ),
    ]);

  const timed = today.filter((e) => !e.allDay && e.startsAt && e.endsAt);
  const current =
    timed.find(
      (e) => e.startsAt!.getTime() <= now.getTime() && now.getTime() < e.endsAt!.getTime(),
    ) ?? null;
  const upcomingToday = timed.find((e) => e.startsAt!.getTime() > now.getTime()) ?? null;
  const nextDeadlineToday =
    deadlines.find(
      (d) => d.dueAt && d.dueAt.getTime() > now.getTime() && d.dueAt.getTime() < end.getTime(),
    ) ?? null;

  // NEXT = the sooner of (next timed event today, next deadline today);
  // if neither, the next upcoming deadline overall.
  let next: DashboardEvent | null = upcomingToday;
  if (
    nextDeadlineToday &&
    (!next || nextDeadlineToday.dueAt!.getTime() < next.startsAt!.getTime())
  ) {
    next = nextDeadlineToday;
  }
  if (!next) next = deadlines.find((d) => d.dueAt && d.dueAt > now) ?? null;

  const monthDots: Record<string, number> = {};
  for (const row of dotRows) monthDots[row.day] = row.n;

  return {
    now,
    today,
    deadlines,
    openTasks,
    activity,
    categories: cats,
    monthDots,
    current,
    next,
  };
}

export async function getCategories(userId: string) {
  return db
    .select({ id: categories.id, name: categories.name, color: categories.color })
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(asc(categories.position));
}
