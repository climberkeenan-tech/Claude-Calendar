"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { activityLog, events } from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";

const createEventSchema = z.object({
  title: z.string().trim().min(1).max(300),
  kind: z.enum(["event", "task"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .or(z.literal("")),
  durationMinutes: z.coerce.number().int().min(5).max(24 * 60).optional(),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  location: z.string().trim().max(300).optional().or(z.literal("")),
});

export type CreateEventState = { error?: string; ok?: boolean };

export async function createEvent(
  _prev: CreateEventState,
  formData: FormData,
): Promise<CreateEventState> {
  const userId = await requireUserId();
  const parsed = createEventSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return { error: "Check the highlighted fields and try again." };
  }
  const v = parsed.data;

  const tz = "America/New_York";
  const id = crypto.randomUUID();

  let startsAt: Date | null = null;
  let endsAt: Date | null = null;
  let dueAt: Date | null = null;
  let allDay = false;

  if (v.time) {
    // Interpret date+time as wall clock in the user's timezone.
    const instant = wallClockToInstant(v.date, v.time, tz);
    if (v.kind === "event") {
      startsAt = instant;
      endsAt = new Date(
        instant.getTime() + (v.durationMinutes ?? 60) * 60 * 1000,
      );
    } else {
      dueAt = instant;
    }
  } else {
    if (v.kind === "event") {
      startsAt = wallClockToInstant(v.date, "00:00", tz);
      endsAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
      allDay = true;
    } else {
      dueAt = wallClockToInstant(v.date, "23:59", tz);
    }
  }

  await db.insert(events).values({
    id,
    userId,
    title: v.title,
    kind: v.kind,
    categoryId: v.categoryId || null,
    location: v.location || null,
    startsAt,
    endsAt,
    allDay,
    dueAt,
    tz,
    source: "manual",
  });
  await db.insert(activityLog).values({
    id: crypto.randomUUID(),
    userId,
    type: "event_created",
    entityType: "event",
    entityId: id,
    data: { title: v.title, kind: v.kind },
  });

  revalidatePath("/");
  return { ok: true };
}

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
  }
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/assignments");
}

/** Convert a wall-clock date+time in a timezone to the correct UTC instant. */
function wallClockToInstant(date: string, time: string, tz: string): Date {
  const naive = new Date(`${date}T${time}:00Z`);
  // What does this UTC guess look like in tz?
  const seen = new Date(naive.toLocaleString("en-US", { timeZone: tz }));
  const drift = naive.getTime() - seen.getTime();
  return new Date(naive.getTime() + drift);
}
