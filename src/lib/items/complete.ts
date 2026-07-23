/** Shared completion core — used by the UI action and the MCP tool. */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activityLog, events } from "@/lib/db/schema";
import {
  acknowledgeJobsForEvent,
  syncJobsForEvent,
} from "@/lib/notifications/scheduler";

export async function completeItemForUser(
  userId: string,
  eventId: string,
  completed: boolean,
): Promise<{ ok: boolean; title?: string }> {
  const now = new Date();
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
