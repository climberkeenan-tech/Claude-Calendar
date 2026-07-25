/** Shared completion core — used by the UI action and the MCP tool. */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activityLog, events, occurrences } from "@/lib/db/schema";
import { isoDayInTz } from "@/lib/tz";
import {
  acknowledgeJobsForEvent,
  syncJobsForEvent,
} from "@/lib/notifications/scheduler";

export async function completeItemForUser(
  userId: string,
  eventId: string,
  completed: boolean,
  /** Which instance of a recurring series (YYYY-MM-DD). Defaults to today. */
  occurrenceDate?: string,
): Promise<{ ok: boolean; title?: string; occurrence?: string }> {
  const now = new Date();

  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      rrule: events.rrule,
      tz: events.tz,
    })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.userId, userId)));
  if (rows.length === 0) return { ok: false };
  const event = rows[0];

  // A recurring item completes ONE occurrence. Flipping the series' own
  // status would retire the whole class for the rest of the semester and
  // silence every future reminder with it.
  if (event.rrule) {
    const dayIso = occurrenceDate ?? isoDayInTz(now, event.tz);
    await db
      .insert(occurrences)
      .values({
        eventId,
        occurrenceDate: dayIso,
        completed,
        completedAt: completed ? now : null,
      })
      .onConflictDoUpdate({
        target: [occurrences.eventId, occurrences.occurrenceDate],
        set: { completed, completedAt: completed ? now : null },
      });
    await db.insert(activityLog).values({
      id: crypto.randomUUID(),
      userId,
      type: completed ? "occurrence_completed" : "occurrence_uncompleted",
      entityType: "event",
      entityId: eventId,
      data: { title: event.title, date: dayIso },
    });
    if (completed) await acknowledgeJobsForEvent(eventId);
    await syncJobsForEvent(eventId);
    return { ok: true, title: event.title, occurrence: dayIso };
  }

  const updated = await db
    .update(events)
    .set(
      completed
        ? { status: "completed", completedAt: now, updatedAt: now }
        : { status: "scheduled", completedAt: null, updatedAt: now },
    )
    .where(and(eq(events.id, eventId), eq(events.userId, userId)))
    .returning({ id: events.id, title: events.title });
  if (updated.length === 0) return { ok: false };

  await db.insert(activityLog).values({
    id: crypto.randomUUID(),
    userId,
    type: completed ? "event_completed" : "event_uncompleted",
    entityType: "event",
    entityId: eventId,
    data: { title: updated[0].title },
  });
  if (completed) await acknowledgeJobsForEvent(eventId);
  await syncJobsForEvent(eventId);
  return { ok: true, title: updated[0].title };
}
