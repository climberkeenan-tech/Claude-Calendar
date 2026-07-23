"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activityLog, events } from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";
import {
  acknowledgeJobsForEvent,
  syncJobsForEvent,
} from "@/lib/notifications/scheduler";

export async function completeEvent(
  eventId: string,
  completed: boolean = true,
): Promise<void> {
  const userId = await requireUserId();
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
  if (updated.length > 0) {
    await db.insert(activityLog).values({
      id: crypto.randomUUID(),
      userId,
      type: completed ? "event_completed" : "event_uncompleted",
      entityType: "event",
      entityId: eventId,
      data: { title: updated[0].title },
    });
    // Completing is acknowledging; either way the job set re-derives
    // (completed → future reminders cancel; un-completed → they come back).
    if (completed) await acknowledgeJobsForEvent(eventId);
    await syncJobsForEvent(eventId);
  }
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/assignments");
}
