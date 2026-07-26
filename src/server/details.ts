"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  checklistItems,
  courses,
  events,
  reminders,
} from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";
import { ownedCourseId } from "@/lib/db/ownership";
import { syncJobsForEvent } from "@/lib/notifications/scheduler";

const refresh = () => {
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/assignments");
};

async function assertOwned(userId: string, eventId: string) {
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.userId, userId)));
  if (rows.length === 0) throw new Error("Event not found");
}

// ---------------------------------------------------------------------------
// Detail fetch (lazy-loaded when the event sheet opens)
// ---------------------------------------------------------------------------

export type EventDetails = {
  description: string | null;
  notes: string | null;
  priority: "low" | "normal" | "high" | "critical";
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  tags: string[];
  courseId: string | null;
  checklist: { id: string; text: string; done: boolean }[];
  reminderOffsets: number[];
};

export async function getEventDetails(eventId: string): Promise<EventDetails> {
  const userId = await requireUserId();
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.userId, userId)));
  if (rows.length === 0) throw new Error("Event not found");
  const e = rows[0];
  const [checklist, rem] = await Promise.all([
    db
      .select({
        id: checklistItems.id,
        text: checklistItems.text,
        done: checklistItems.done,
      })
      .from(checklistItems)
      .where(eq(checklistItems.eventId, eventId))
      .orderBy(asc(checklistItems.position)),
    db
      .select({ offsetMinutes: reminders.offsetMinutes })
      .from(reminders)
      .where(and(eq(reminders.eventId, eventId), eq(reminders.enabled, true))),
  ]);
  return {
    description: e.description,
    notes: e.notes,
    priority: e.priority,
    estimatedMinutes: e.estimatedMinutes,
    actualMinutes: e.actualMinutes,
    tags: e.tags ?? [],
    courseId: e.courseId,
    checklist,
    reminderOffsets: rem
      .map((r) => r.offsetMinutes)
      .filter((n): n is number => n !== null)
      .sort((a, b) => b - a),
  };
}

// ---------------------------------------------------------------------------
// Detail fields update
// ---------------------------------------------------------------------------

const detailsSchema = z.object({
  eventId: z.string(),
  description: z.string().trim().max(5000).nullable(),
  notes: z.string().trim().max(5000).nullable(),
  priority: z.enum(["low", "normal", "high", "critical"]),
  estimatedMinutes: z.number().int().min(1).max(6000).nullable(),
  actualMinutes: z.number().int().min(1).max(6000).nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  courseId: z.string().nullable(),
});

export async function updateEventDetails(
  input: z.infer<typeof detailsSchema>,
): Promise<void> {
  const userId = await requireUserId();
  const v = detailsSchema.parse(input);
  await assertOwned(userId, v.eventId);
  v.courseId = await ownedCourseId(userId, v.courseId);
  await db
    .update(events)
    .set({
      description: v.description || null,
      notes: v.notes || null,
      priority: v.priority,
      estimatedMinutes: v.estimatedMinutes,
      actualMinutes: v.actualMinutes,
      tags: v.tags.length > 0 ? v.tags : null,
      courseId: v.courseId,
      updatedAt: new Date(),
    })
    .where(eq(events.id, v.eventId));
  refresh();
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export async function addChecklistItem(eventId: string, text: string): Promise<string> {
  const userId = await requireUserId();
  await assertOwned(userId, eventId);
  const clean = text.trim().slice(0, 300);
  if (!clean) throw new Error("Empty item");
  const existing = await db
    .select({ position: checklistItems.position })
    .from(checklistItems)
    .where(eq(checklistItems.eventId, eventId));
  const id = crypto.randomUUID();
  await db.insert(checklistItems).values({
    id,
    eventId,
    text: clean,
    position: existing.length,
  });
  refresh();
  return id;
}

export async function toggleChecklistItem(itemId: string, done: boolean): Promise<void> {
  const userId = await requireUserId();
  const rows = await db
    .select({ eventId: checklistItems.eventId })
    .from(checklistItems)
    .where(eq(checklistItems.id, itemId));
  if (rows.length === 0) return;
  await assertOwned(userId, rows[0].eventId);
  await db.update(checklistItems).set({ done }).where(eq(checklistItems.id, itemId));
  refresh();
}

export async function deleteChecklistItem(itemId: string): Promise<void> {
  const userId = await requireUserId();
  const rows = await db
    .select({ eventId: checklistItems.eventId })
    .from(checklistItems)
    .where(eq(checklistItems.id, itemId));
  if (rows.length === 0) return;
  await assertOwned(userId, rows[0].eventId);
  await db.delete(checklistItems).where(eq(checklistItems.id, itemId));
  refresh();
}

// ---------------------------------------------------------------------------
// Reminders (intent only — delivery is Phase 5)
// ---------------------------------------------------------------------------

const offsetsSchema = z.object({
  eventId: z.string(),
  offsets: z.array(z.number().int().min(0).max(60 * 24 * 30)).max(8),
});

export async function setEventReminders(
  input: z.infer<typeof offsetsSchema>,
): Promise<void> {
  const userId = await requireUserId();
  const v = offsetsSchema.parse(input);
  await assertOwned(userId, v.eventId);

  // Touch only what actually changed. notification_jobs cascades from
  // reminders, and that table holds the sent bell entries and any active
  // snooze — so deleting every row and re-inserting meant nudging one
  // reminder from 30 minutes to 60 also erased the event's notification
  // history and quietly un-snoozed it. Absolute reminders aren't part of this
  // editor's model and are left alone rather than collected as collateral.
  const existing = await db
    .select({ id: reminders.id, offsetMinutes: reminders.offsetMinutes })
    .from(reminders)
    .where(eq(reminders.eventId, v.eventId));

  const wanted = new Set(v.offsets);
  const kept = new Set<number>();
  const removeIds: string[] = [];
  for (const r of existing) {
    if (r.offsetMinutes === null) continue; // absolute — not ours to manage
    // First row for a wanted offset stays; anything else goes, which also
    // collapses duplicates the old delete-everything path used to dedupe.
    if (wanted.has(r.offsetMinutes) && !kept.has(r.offsetMinutes)) {
      kept.add(r.offsetMinutes);
    } else {
      removeIds.push(r.id);
    }
  }
  const addOffsets = [...wanted].filter((o) => !kept.has(o));

  type Batchable = Parameters<typeof db.batch>[0][number];
  const statements: Batchable[] = [];
  if (removeIds.length > 0) {
    statements.push(db.delete(reminders).where(inArray(reminders.id, removeIds)));
  }
  if (addOffsets.length > 0) {
    statements.push(
      db.insert(reminders).values(
        addOffsets.map((offsetMinutes) => ({
          id: crypto.randomUUID(),
          eventId: v.eventId,
          offsetMinutes,
          // Push first; an unacknowledged push falls back to email (§7) —
          // both-at-once would just train inbox blindness.
          channels: ["push"],
        })),
      ),
    );
  }
  // One change, so a failure between the removal and the addition can't leave
  // an event with no reminders at all.
  if (statements.length > 0) {
    await db.batch(statements as [Batchable, ...Batchable[]]);
  }
  await syncJobsForEvent(v.eventId);
  refresh();
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

const courseSchema = z.object({
  id: z.string().nullable(),
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().max(40).nullable(),
  professor: z.string().trim().max(200).nullable(),
  location: z.string().trim().max(200).nullable(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
  term: z.string().trim().max(60).nullable(),
});

export async function saveCourse(input: z.infer<typeof courseSchema>): Promise<void> {
  const userId = await requireUserId();
  const v = courseSchema.parse(input);
  if (v.id) {
    await db
      .update(courses)
      .set({
        name: v.name,
        code: v.code,
        professor: v.professor,
        location: v.location,
        color: v.color,
        term: v.term,
      })
      .where(and(eq(courses.id, v.id), eq(courses.userId, userId)));
  } else {
    await db.insert(courses).values({
      id: crypto.randomUUID(),
      userId,
      name: v.name,
      code: v.code,
      professor: v.professor,
      location: v.location,
      color: v.color,
      term: v.term,
    });
  }
  revalidatePath("/settings/courses");
  refresh();
}

export async function deleteCourse(courseId: string): Promise<void> {
  const userId = await requireUserId();
  await db
    .delete(courses)
    .where(and(eq(courses.id, courseId), eq(courses.userId, userId)));
  revalidatePath("/settings/courses");
  refresh();
}
