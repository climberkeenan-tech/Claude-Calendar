import { and, eq, gte, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { categories, courses, events, occurrences } from "@/lib/db/schema";
import type { FeedEvent, FeedOccurrence } from "@/lib/ics/feed";

/**
 * Rows for the ICS subscription feed.
 *
 * Non-recurring items are bounded to a window — a subscribed calendar wants
 * "the semester", not five years of history. Recurring series are always
 * included regardless of when they started, because the RRULE travels with
 * them and the subscriber's client does the expanding; clipping them to the
 * window would silently truncate a class that started in August.
 */
export const FEED_DAYS_BACK = 90;
export const FEED_DAYS_AHEAD = 365;

const shape = {
  id: events.id,
  title: events.title,
  kind: events.kind,
  description: events.description,
  location: events.location,
  startsAt: events.startsAt,
  endsAt: events.endsAt,
  dueAt: events.dueAt,
  allDay: events.allDay,
  rrule: events.rrule,
  tz: events.tz,
  status: events.status,
  updatedAt: events.updatedAt,
  categoryName: categories.name,
  courseName: courses.name,
};

export async function getFeedRows(
  userId: string,
  now: Date,
): Promise<{ events: FeedEvent[]; occurrencesByEvent: Map<string, FeedOccurrence[]> }> {
  const windowStart = new Date(now.getTime() - FEED_DAYS_BACK * 86_400_000);
  const windowEnd = new Date(now.getTime() + FEED_DAYS_AHEAD * 86_400_000);

  const base = and(eq(events.userId, userId), ne(events.status, "cancelled"));

  const [singles, series, tasks] = await Promise.all([
    db
      .select(shape)
      .from(events)
      .leftJoin(categories, eq(events.categoryId, categories.id))
      .leftJoin(courses, eq(events.courseId, courses.id))
      .where(
        and(
          base,
          ne(events.kind, "task"),
          isNull(events.rrule),
          isNotNull(events.startsAt),
          lt(events.startsAt, windowEnd),
          or(gte(events.endsAt, windowStart), gte(events.startsAt, windowStart)),
        ),
      ),
    db
      .select(shape)
      .from(events)
      .leftJoin(categories, eq(events.categoryId, categories.id))
      .leftJoin(courses, eq(events.courseId, courses.id))
      .where(
        and(
          base,
          ne(events.kind, "task"),
          isNotNull(events.rrule),
          isNotNull(events.startsAt),
          lt(events.startsAt, windowEnd),
        ),
      ),
    db
      .select(shape)
      .from(events)
      .leftJoin(categories, eq(events.categoryId, categories.id))
      .leftJoin(courses, eq(events.courseId, courses.id))
      .where(
        and(
          base,
          eq(events.kind, "task"),
          eq(events.status, "scheduled"), // a met deadline isn't a deadline
          isNotNull(events.dueAt),
          gte(events.dueAt, windowStart),
          lt(events.dueAt, windowEnd),
        ),
      ),
  ]);

  const rows = [...singles, ...series, ...tasks] as FeedEvent[];

  const seriesIds = series.map((s) => s.id);
  const occRows = seriesIds.length
    ? await db
        .select({
          eventId: occurrences.eventId,
          occurrenceDate: occurrences.occurrenceDate,
          cancelled: occurrences.cancelled,
          completed: occurrences.completed,
          overrides: occurrences.overrides,
        })
        .from(occurrences)
        .where(inArray(occurrences.eventId, seriesIds))
    : [];

  const byEvent = new Map<string, FeedOccurrence[]>();
  for (const o of occRows) {
    const list = byEvent.get(o.eventId) ?? [];
    list.push({
      eventId: o.eventId,
      occurrenceDate: o.occurrenceDate,
      cancelled: o.cancelled,
      completed: o.completed,
      overrides: o.overrides ?? null,
    });
    byEvent.set(o.eventId, list);
  }

  return { events: rows, occurrencesByEvent: byEvent };
}
