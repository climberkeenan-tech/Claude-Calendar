"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { activityLog, events, occurrences } from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";
import { untilBefore, withUntil } from "@/lib/calendar/recurrence";
import { isoDayInTz, toFloating, fromFloating } from "@/lib/tz";
import { ownedCategoryId } from "@/lib/db/ownership";

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

type OverridePatch = {
  startsAt?: string;
  endsAt?: string;
  title?: string;
  location?: string;
};

/** Merge a patch into an occurrence's overrides without clobbering the rest. */
async function mergeOccurrenceOverrides(
  eventId: string,
  occurrenceDate: string,
  patch: OverridePatch,
) {
  const existing = await db
    .select()
    .from(occurrences)
    .where(
      and(
        eq(occurrences.eventId, eventId),
        eq(occurrences.occurrenceDate, occurrenceDate),
      ),
    );
  const merged: OverridePatch = { ...(existing[0]?.overrides ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
  }
  await db
    .insert(occurrences)
    .values({ eventId, occurrenceDate, overrides: merged })
    .onConflictDoUpdate({
      target: [occurrences.eventId, occurrences.occurrenceDate],
      set: { overrides: merged },
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
  if (v.endsAt.getTime() <= v.startsAt.getTime()) return; // never write inverted ranges
  const event = await ownedEvent(userId, v.eventId);

  if (event.rrule && v.occurrenceDate) {
    // Move one occurrence — merge, don't clobber title/location overrides.
    await mergeOccurrenceOverrides(event.id, v.occurrenceDate, {
      startsAt: v.startsAt.toISOString(),
      endsAt: v.endsAt.toISOString(),
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
  /** The occurrence's ORIGINAL start — the split anchor for 'future'. */
  occurrenceStart: z.coerce.date().nullable(),
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
  v.categoryId = await ownedCategoryId(userId, v.categoryId);

  if (!event.rrule || !v.occurrenceDate || v.scope === "series") {
    let startsAt = v.startsAt ?? event.startsAt;
    let endsAt = v.endsAt ?? event.endsAt;
    if (event.rrule && event.startsAt && v.startsAt) {
      // Whole-series edit: the dialog shows ONE occurrence's date, so only the
      // wall-clock TIME (and duration) may move — re-anchoring the series to
      // the clicked occurrence's date would erase every earlier occurrence.
      const orig = toFloating(event.startsAt, event.tz);
      const edited = toFloating(v.startsAt, event.tz);
      const timeOfDayMs =
        edited.getTime() - Date.UTC(
          edited.getUTCFullYear(), edited.getUTCMonth(), edited.getUTCDate());
      const anchorDay = Date.UTC(
        orig.getUTCFullYear(), orig.getUTCMonth(), orig.getUTCDate());
      startsAt = fromFloating(new Date(anchorDay + timeOfDayMs), event.tz);
      const durMs =
        v.endsAt && v.startsAt
          ? v.endsAt.getTime() - v.startsAt.getTime()
          : event.endsAt && event.startsAt
            ? event.endsAt.getTime() - event.startsAt.getTime()
            : 60 * 60 * 1000;
      endsAt = new Date(startsAt.getTime() + durMs);
    }
    await db
      .update(events)
      .set({
        title: v.title,
        location: v.location,
        categoryId: v.categoryId,
        startsAt,
        endsAt,
        dueAt: v.dueAt ?? event.dueAt,
        updatedAt: new Date(),
      })
      .where(eq(events.id, event.id));
  } else if (v.scope === "single") {
    await mergeOccurrenceOverrides(event.id, v.occurrenceDate, {
      title: v.title === event.title ? undefined : v.title,
      location: v.location ?? undefined,
      startsAt: v.startsAt?.toISOString(),
      endsAt: v.endsAt?.toISOString(),
    });
  } else {
    // this-and-future: trim the old series at the ORIGINAL occurrence slot,
    // start a new series at the edited time.
    if (!v.startsAt) return { error: "A start time is required." };
    const splitAt = v.occurrenceStart ?? v.startsAt;
    const until = untilBefore(
      { id: event.id, startsAt: event.startsAt!, endsAt: event.endsAt, rrule: event.rrule, tz: event.tz },
      splitAt,
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
      rrule: retargetWeekday(stripUntil(event.rrule), splitAt, v.startsAt, event.tz),
      tz: event.tz,
      priority: event.priority,
      source: event.source,
      habitTargetPerWeek: event.habitTargetPerWeek,
    });
    // Occurrence state (cancellations, completions, moves) at/after the split
    // belongs to the new series — re-key it, or cancelled days resurrect.
    await db
      .update(occurrences)
      .set({ eventId: newId })
      .where(
        and(
          eq(occurrences.eventId, event.id),
          gte(occurrences.occurrenceDate, isoDayInTz(splitAt, event.tz)),
        ),
      );
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

const RRULE_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** If a this-and-future edit moved the anchor to a new weekday, swap that day
 * in BYDAY so the new series actually contains its own DTSTART. */
function retargetWeekday(rruleStr: string, from: Date, to: Date, tz: string): string {
  const dayOf = (d: Date) => (toFloating(d, tz).getUTCDay() + 6) % 7; // Mon=0
  const fromDay = RRULE_DAYS[dayOf(from)];
  const toDay = RRULE_DAYS[dayOf(to)];
  if (fromDay === toDay) return rruleStr;
  return rruleStr
    .split(";")
    .map((part) => {
      if (!part.toUpperCase().startsWith("BYDAY=")) return part;
      const days = part.slice(6).split(",");
      const swapped = days.map((d) => (d === fromDay ? toDay : d));
      return `BYDAY=${[...new Set(swapped)].join(",")}`;
    })
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
