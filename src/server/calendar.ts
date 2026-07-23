"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { activityLog, events, occurrences } from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";
import { untilBefore, withUntil } from "@/lib/calendar/recurrence";

const refresh = () => {
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/assignments");
};

async function ownedEvent(userId: string, eventId: string) {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.userId, userId)));
  if (rows.length === 0) throw new Error("Event not found");
  return rows[0];
}

async function log(userId: string, type: string, entityId: string, data: Record<string, unknown>) {
  await db.insert(activityLog).values({
    id: crypto.randomUUID(),
    userId,
    type,
    entityType: "event",
    entityId,
    data,
  });
}

// ---------------------------------------------------------------------------
// Drag / resize commit
// ---------------------------------------------------------------------------

const moveSchema = z.object({
  eventId: z.string(),
  occurrenceDate: z.string().nullable(), // set → this occurrence only
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
});

export async function moveEvent(input: z.infer<typeof moveSchema>): Promise<void> {
  const userId = await requireUserId();
  const v = moveSchema.parse(input);
  const event = await ownedEvent(userId, v.eventId);

  if (event.rrule && v.occurrenceDate) {
    // Move one occurrence: write/merge an override row.
    await db
      .insert(occurrences)
      .values({
        eventId: event.id,
        occurrenceDate: v.occurrenceDate,
        overrides: { startsAt: v.startsAt.toISOString(), endsAt: v.endsAt.toISOString() },
      })
      .onConflictDoUpdate({
        target: [occurrences.eventId, occurrences.occurrenceDate],
        set: {
          overrides: { startsAt: v.startsAt.toISOString(), endsAt: v.endsAt.toISOString() },
        },
      });
  } else if (event.kind === "task") {
    await db
      .update(events)
      .set({ dueAt: v.startsAt, updatedAt: new Date() })
      .where(eq(events.id, event.id));
  } else {
    await db
      .update(events)
      .set({ startsAt: v.startsAt, endsAt: v.endsAt, updatedAt: new Date() })
      .where(eq(events.id, event.id));
  }
  await log(userId, "event_moved", event.id, { title: event.title });
  refresh();
}

// ---------------------------------------------------------------------------
// Edit (single / series / future)
// ---------------------------------------------------------------------------

const editSchema = z.object({
  eventId: z.string(),
  occurrenceDate: z.string().nullable(),
  scope: z.enum(["single", "series", "future"]),
  title: z.string().trim().min(1).max(300),
  location: z.string().trim().max(300).nullable(),
  categoryId: z.string().nullable(),
  startsAt: z.coerce.date().nullable(),
  endsAt: z.coerce.date().nullable(),
  dueAt: z.coerce.date().nullable(),
});

export async function editEvent(input: z.infer<typeof editSchema>): Promise<{ error?: string }> {
  const userId = await requireUserId();
  const v = editSchema.parse(input);
  const event = await ownedEvent(userId, v.eventId);

  if (!event.rrule || v.scope === "series" || !v.occurrenceDate) {
    // Whole event / whole series. Note: changing the series' startsAt shifts
    // the wall-clock time of every occurrence (DTSTART drives expansion).
    await db
      .update(events)
      .set({
        title: v.title,
        location: v.location,
        categoryId: v.categoryId,
        startsAt: v.startsAt ?? event.startsAt,
        endsAt: v.endsAt ?? event.endsAt,
        dueAt: v.dueAt ?? event.dueAt,
        updatedAt: new Date(),
      })
      .where(eq(events.id, event.id));
  } else if (v.scope === "single") {
    await db
      .insert(occurrences)
      .values({
        eventId: event.id,
        occurrenceDate: v.occurrenceDate,
        overrides: {
          title: v.title === event.title ? undefined : v.title,
          location: v.location ?? undefined,
          startsAt: v.startsAt?.toISOString(),
          endsAt: v.endsAt?.toISOString(),
        },
      })
      .onConflictDoUpdate({
        target: [occurrences.eventId, occurrences.occurrenceDate],
        set: {
          overrides: {
            title: v.title === event.title ? undefined : v.title,
            location: v.location ?? undefined,
            startsAt: v.startsAt?.toISOString(),
            endsAt: v.endsAt?.toISOString(),
          },
        },
      });
  } else {
    // this-and-future: trim the old series, start a new one at the split.
    if (!v.startsAt) return { error: "A start time is required." };
    const until = untilBefore(
      { id: event.id, startsAt: event.startsAt!, endsAt: event.endsAt, rrule: event.rrule, tz: event.tz },
      v.startsAt,
    );
    const newId = crypto.randomUUID();
    const durationMs =
      v.endsAt && v.startsAt
        ? v.endsAt.getTime() - v.startsAt.getTime()
        : event.endsAt && event.startsAt
          ? event.endsAt.getTime() - event.startsAt.getTime()
          : 60 * 60 * 1000;
    if (until) {
      await db
        .update(events)
        .set({ rrule: withUntil(event.rrule, until), updatedAt: new Date() })
        .where(eq(events.id, event.id));
    } else {
      // Split lands on/before the first occurrence — the old series vanishes.
      await db
        .update(events)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(events.id, event.id));
    }
    await db.insert(events).values({
      id: newId,
      userId,
      title: v.title,
      kind: event.kind,
      categoryId: v.categoryId ?? event.categoryId,
      courseId: event.courseId,
      location: v.location ?? event.location,
      startsAt: v.startsAt,
      endsAt: new Date(v.startsAt.getTime() + durationMs),
      allDay: event.allDay,
      rrule: stripUntil(event.rrule),
      tz: event.tz,
      priority: event.priority,
      source: event.source,
      habitTargetPerWeek: event.habitTargetPerWeek,
    });
  }
  await log(userId, "event_edited", event.id, { title: v.title, scope: v.scope });
  refresh();
  return {};
}

function stripUntil(rruleStr: string): string {
  return rruleStr
    .split(";")
    .filter((p) => p && !p.toUpperCase().startsWith("UNTIL="))
    .join(";");
}

// ---------------------------------------------------------------------------
// Delete (single / series / future)
// ---------------------------------------------------------------------------

const deleteSchema = z.object({
  eventId: z.string(),
  occurrenceDate: z.string().nullable(),
  occurrenceStart: z.coerce.date().nullable(),
  scope: z.enum(["single", "series", "future"]),
});

export async function deleteEvent(input: z.infer<typeof deleteSchema>): Promise<void> {
  const userId = await requireUserId();
  const v = deleteSchema.parse(input);
  const event = await ownedEvent(userId, v.eventId);

  if (!event.rrule || v.scope === "series" || !v.occurrenceDate) {
    await db.delete(events).where(eq(events.id, event.id));
  } else if (v.scope === "single") {
    await db
      .insert(occurrences)
      .values({ eventId: event.id, occurrenceDate: v.occurrenceDate, cancelled: true })
      .onConflictDoUpdate({
        target: [occurrences.eventId, occurrences.occurrenceDate],
        set: { cancelled: true },
      });
  } else {
    const splitStart = v.occurrenceStart ?? new Date();
    const until = untilBefore(
      { id: event.id, startsAt: event.startsAt!, endsAt: event.endsAt, rrule: event.rrule, tz: event.tz },
      splitStart,
    );
    if (until) {
      await db
        .update(events)
        .set({ rrule: withUntil(event.rrule, until), updatedAt: new Date() })
        .where(eq(events.id, event.id));
    } else {
      await db.delete(events).where(eq(events.id, event.id));
    }
  }
  await log(userId, "event_deleted", event.id, { title: event.title, scope: v.scope });
  refresh();
}

// ---------------------------------------------------------------------------
// Occurrence completion (recurring events + habits)
// ---------------------------------------------------------------------------

export async function toggleOccurrence(
  eventId: string,
  occurrenceDate: string,
  completed: boolean,
): Promise<void> {
  const userId = await requireUserId();
  const event = await ownedEvent(userId, eventId);
  await db
    .insert(occurrences)
    .values({
      eventId,
      occurrenceDate,
      completed,
      completedAt: completed ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [occurrences.eventId, occurrences.occurrenceDate],
      set: { completed, completedAt: completed ? new Date() : null },
    });
  await log(userId, completed ? "occurrence_completed" : "occurrence_uncompleted", eventId, {
    title: event.title,
    date: occurrenceDate,
  });
  refresh();
}

// ---------------------------------------------------------------------------
// Inbox scheduling
// ---------------------------------------------------------------------------

export async function scheduleTask(eventId: string, dueAt: Date): Promise<void> {
  const userId = await requireUserId();
  const event = await ownedEvent(userId, eventId);
  await db
    .update(events)
    .set({ dueAt, updatedAt: new Date() })
    .where(eq(events.id, event.id));
  await log(userId, "task_scheduled", eventId, { title: event.title });
  refresh();
}
