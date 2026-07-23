import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { categories, courses, events, occurrences } from "@/lib/db/schema";
import { expandEvent, type OccurrenceOverride } from "@/lib/calendar/recurrence";

export type CalendarItem = {
  id: string; // event id
  occurrenceDate: string | null; // set for recurring instances
  title: string;
  kind: "event" | "task" | "habit";
  startsAt: Date | null;
  endsAt: Date | null;
  dueAt: Date | null;
  allDay: boolean;
  location: string | null;
  recurring: boolean;
  completed: boolean;
  priority: "low" | "normal" | "high" | "critical";
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  courseName: string | null;
};

const shape = {
  id: events.id,
  title: events.title,
  kind: events.kind,
  startsAt: events.startsAt,
  endsAt: events.endsAt,
  dueAt: events.dueAt,
  allDay: events.allDay,
  location: events.location,
  rrule: events.rrule,
  tz: events.tz,
  status: events.status,
  priority: events.priority,
  categoryId: events.categoryId,
  categoryName: categories.name,
  categoryColor: categories.color,
  courseName: courses.name,
};

/**
 * Everything visible in [start, end): scheduled events (recurring ones
 * expanded server-side), tasks due in the window, and habit occurrences.
 */
export async function getCalendarWindow(
  userId: string,
  start: Date,
  end: Date,
): Promise<CalendarItem[]> {
  const [singles, recurring, tasksDue] = await Promise.all([
    db
      .select(shape)
      .from(events)
      .leftJoin(categories, eq(events.categoryId, categories.id))
      .leftJoin(courses, eq(events.courseId, courses.id))
      .where(
        and(
          eq(events.userId, userId),
          ne(events.status, "cancelled"),
          isNull(events.rrule),
          isNotNull(events.startsAt),
          lt(events.startsAt, end),
          or(gte(events.endsAt, start), gte(events.startsAt, start)),
        ),
      ),
    db
      .select(shape)
      .from(events)
      .leftJoin(categories, eq(events.categoryId, categories.id))
      .leftJoin(courses, eq(events.courseId, courses.id))
      .where(
        and(
          eq(events.userId, userId),
          ne(events.status, "cancelled"),
          isNotNull(events.rrule),
          isNotNull(events.startsAt),
          lt(events.startsAt, end), // series can't produce instances before it starts
        ),
      ),
    db
      .select(shape)
      .from(events)
      .leftJoin(categories, eq(events.categoryId, categories.id))
      .leftJoin(courses, eq(events.courseId, courses.id))
      .where(
        and(
          eq(events.userId, userId),
          eq(events.kind, "task"),
          ne(events.status, "cancelled"),
          isNotNull(events.dueAt),
          gte(events.dueAt, start),
          lt(events.dueAt, end),
        ),
      ),
  ]);

  const overrideRows =
    recurring.length > 0
      ? await db
          .select()
          .from(occurrences)
          .where(
            inArray(
              occurrences.eventId,
              recurring.map((r) => r.id),
            ),
          )
      : [];
  const overridesByEvent = new Map<string, OccurrenceOverride[]>();
  for (const row of overrideRows) {
    const list = overridesByEvent.get(row.eventId) ?? [];
    list.push({
      occurrenceDate: row.occurrenceDate,
      cancelled: row.cancelled,
      completed: row.completed,
      overrides: row.overrides,
    });
    overridesByEvent.set(row.eventId, list);
  }

  const items: CalendarItem[] = [];

  for (const e of singles) {
    items.push({
      id: e.id,
      occurrenceDate: null,
      title: e.title,
      kind: e.kind,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      dueAt: e.dueAt,
      allDay: e.allDay,
      location: e.location,
      recurring: false,
      completed: e.status === "completed",
      priority: e.priority,
      categoryId: e.categoryId,
      categoryName: e.categoryName,
      categoryColor: e.categoryColor,
      courseName: e.courseName,
    });
  }

  for (const e of recurring) {
    const expanded = expandEvent(
      {
        id: e.id,
        startsAt: e.startsAt!,
        endsAt: e.endsAt,
        rrule: e.rrule,
        tz: e.tz,
      },
      overridesByEvent.get(e.id) ?? [],
      start,
      end,
    );
    for (const occ of expanded) {
      items.push({
        id: e.id,
        occurrenceDate: occ.occurrenceDate,
        title: occ.titleOverride ?? e.title,
        kind: e.kind,
        startsAt: occ.startsAt,
        endsAt: occ.endsAt,
        dueAt: null,
        allDay: e.allDay,
        location: occ.locationOverride ?? e.location,
        recurring: true,
        completed: occ.completed,
        priority: e.priority,
        categoryId: e.categoryId,
        categoryName: e.categoryName,
        categoryColor: e.categoryColor,
        courseName: e.courseName,
      });
    }
  }

  for (const t of tasksDue) {
    items.push({
      id: t.id,
      occurrenceDate: null,
      title: t.title,
      kind: t.kind,
      startsAt: null,
      endsAt: null,
      dueAt: t.dueAt,
      allDay: false,
      location: t.location,
      recurring: false,
      completed: t.status === "completed",
      priority: t.priority,
      categoryId: t.categoryId,
      categoryName: t.categoryName,
      categoryColor: t.categoryColor,
      courseName: t.courseName,
    });
  }

  items.sort((a, b) => {
    const ta = (a.startsAt ?? a.dueAt)?.getTime() ?? 0;
    const tb = (b.startsAt ?? b.dueAt)?.getTime() ?? 0;
    return ta - tb;
  });
  return items;
}

/** Habits with this week's completion state (for the dashboard zone). */
export async function getHabitsWeek(userId: string, weekStart: Date, weekEnd: Date) {
  const habits = await db
    .select({
      id: events.id,
      title: events.title,
      target: events.habitTargetPerWeek,
      rrule: events.rrule,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      tz: events.tz,
      categoryColor: categories.color,
    })
    .from(events)
    .leftJoin(categories, eq(events.categoryId, categories.id))
    .where(
      and(
        eq(events.userId, userId),
        eq(events.kind, "habit"),
        ne(events.status, "cancelled"),
      ),
    )
    .orderBy(asc(events.createdAt));

  if (habits.length === 0) return [];

  const rows = await db
    .select()
    .from(occurrences)
    .where(
      inArray(
        occurrences.eventId,
        habits.map((h) => h.id),
      ),
    );

  const startIso = weekStart.toISOString().slice(0, 10);
  const endIso = weekEnd.toISOString().slice(0, 10);
  return habits.map((h) => {
    const done = rows.filter(
      (r) =>
        r.eventId === h.id &&
        r.completed &&
        r.occurrenceDate >= startIso &&
        r.occurrenceDate < endIso,
    );
    return {
      id: h.id,
      title: h.title,
      target: h.target ?? 7,
      doneDates: done.map((d) => d.occurrenceDate).sort(),
      categoryColor: h.categoryColor,
    };
  });
}
