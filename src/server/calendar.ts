"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { activityLog, events, occurrences, reminders } from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";
import { carryUntil, untilBefore, withUntil } from "@/lib/calendar/recurrence";
import { isoDayDiff, shiftIsoDate } from "@/lib/calendar/split";
import { isoDayInTz, toFloating, fromFloating } from "@/lib/tz";
import { ownedCategoryId } from "@/lib/db/ownership";
import {
  acknowledgeJobsForEvent,
  syncJobsForEvent,
} from "@/lib/notifications/scheduler";

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
  startsAt?: string | null;
  endsAt?: string | null;
  title?: string | null;
  location?: string | null;
};

/** Merge a patch into an occurrence's overrides without clobbering the rest.
 * Semantics: undefined = leave key alone; null = DELETE the key (occurrence
 * reverts to the series value — otherwise a one-off rename could never be
 * undone). */
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
  const merged: Record<string, unknown> = { ...(existing[0]?.overrides ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete merged[k];
    else merged[k] = v;
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
  await syncJobsForEvent(event.id);
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
    if (event.kind === "task") {
      // Kind invariant: tasks live on dueAt only — a task with startsAt would
      // render both as a calendar block and a deadline (duplicate items).
      await db
        .update(events)
        .set({
          title: v.title,
          location: v.location,
          categoryId: v.categoryId,
          dueAt: v.dueAt ?? event.dueAt,
          updatedAt: new Date(),
        })
        .where(eq(events.id, event.id));
      await log(userId, "event_edited", event.id, { title: v.title, scope: v.scope });
      await syncJobsForEvent(event.id);
      refresh();
      return {};
    }
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
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      return { error: "The end time must be after the start time." };
    }
    await db
      .update(events)
      .set({
        title: v.title,
        location: v.location,
        categoryId: v.categoryId,
        startsAt,
        endsAt,
        updatedAt: new Date(),
      })
      .where(eq(events.id, event.id));
  } else if (v.scope === "single") {
    if (
      v.startsAt &&
      v.endsAt &&
      v.endsAt.getTime() <= v.startsAt.getTime()
    ) {
      return { error: "The end time must be after the start time." };
    }
    await mergeOccurrenceOverrides(event.id, v.occurrenceDate, {
      // null deletes the override — editing back to the series value reverts
      // cleanly instead of pinning a stale copy forever.
      title: v.title === event.title ? null : v.title,
      location: !v.location || v.location === event.location ? null : v.location,
      startsAt: v.startsAt?.toISOString(),
      endsAt: v.endsAt?.toISOString(),
    });
  } else {
    // this-and-future: trim the old series at the ORIGINAL occurrence slot,
    // start a new series at the edited time.
    if (!v.startsAt) return { error: "A start time is required." };
    if (v.endsAt && v.endsAt.getTime() <= v.startsAt.getTime()) {
      return { error: "The end time must be after the start time." };
    }
    // Split at the occurrence's ORIGINAL slot, derived from its date + the
    // series' wall-clock time. Never trust the client's startsAt for this:
    // for a previously dragged occurrence that's the MOVED time, which splits
    // in the wrong place and duplicates the instance.
    const splitAt = originalSlot(v.occurrenceDate, event.startsAt!, event.tz);
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
    // EVERY read happens before the first write, so the whole split can go out
    // as ONE batch below. neon-http has no interactive transactions
    // (db.transaction throws) — db.batch is the only atomic unit available,
    // and without it a failure between the trim and the insert leaves the
    // series truncated with no continuation: every future class silently gone,
    // and unrecoverable because retrying re-trims an already-trimmed series.
    const oldReminders = await db
      .select()
      .from(reminders)
      .where(eq(reminders.eventId, event.id));
    const splitIso = isoDayInTz(splitAt, event.tz);
    const movedRows = await db
      .select()
      .from(occurrences)
      .where(
        and(
          eq(occurrences.eventId, event.id),
          gte(occurrences.occurrenceDate, splitIso),
        ),
      );

    type Batchable = Parameters<typeof db.batch>[0][number];
    const statements: Batchable[] = [];

    statements.push(
      until
        ? db
            .update(events)
            .set({ rrule: withUntil(event.rrule, until), updatedAt: new Date() })
            .where(eq(events.id, event.id))
        : // Split lands on/before the first occurrence — the old series vanishes.
          db
            .update(events)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(eq(events.id, event.id)),
    );
    statements.push(db.insert(events).values({
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
      // Keep the ORIGINAL bound. stripUntil() here dropped it, so a
      // syllabus-imported class (map.ts bounds every one at term end) recurred
      // forever the first time it was edited with "this & future" — 29 real
      // meetings became 193. retargetWeekday only rewrites BYDAY, so UNTIL
      // rides through untouched; the only reason to touch it is the case
      // below, where the edit pushes the occurrence past the old bound.
      rrule: retargetWeekday(
        carryUntil(event.rrule, v.startsAt, event.tz),
        splitAt,
        v.startsAt,
        event.tz,
      ),
      tz: event.tz,
      priority: event.priority,
      source: event.source,
      habitTargetPerWeek: event.habitTargetPerWeek,
      // The continuing half is the SAME event: carry every field forward.
      // Dropping these silently lost notes/tags/estimates and (via sourceId)
      // broke syllabus undo for the split-off half.
      description: event.description,
      notes: event.notes,
      tags: event.tags,
      estimatedMinutes: event.estimatedMinutes,
      actualMinutes: event.actualMinutes,
      sourceId: event.sourceId,
    }));
    // Reminders are keyed by eventId — without copying them the continuing
    // series would go permanently silent (desiredJobs returns [] with no
    // reminder rows). Offset reminders copy cleanly; absolute ones belong to
    // the moment they were set for and stay with the old half.
    const carried = oldReminders.filter((r) => r.offsetMinutes !== null);
    if (carried.length > 0) {
      statements.push(
        db.insert(reminders).values(
          carried.map((r) => ({
            id: crypto.randomUUID(),
            eventId: newId,
            offsetMinutes: r.offsetMinutes,
            absoluteAt: null,
            channels: r.channels,
            enabled: r.enabled,
          })),
        ),
      );
    }
    // Occurrence state (cancellations, completions, moves) at/after the split
    // belongs to the new series — re-key it, or cancelled days resurrect.
    // When the edit moved the series to a different weekday, rows sitting on
    // the OLD weekday must also have their dates translated, or they attach
    // to dates the new rule never generates (ghost/orphaned occurrences).
    if (movedRows.length > 0) {
      const fromDow = weekdayInTz(splitAt, event.tz);
      // The shift is the REAL calendar distance from the split slot to the new
      // start — not a weekday difference wrapped into [-3,+3]. Wrapping sent a
      // Monday→Friday move 3 days BACKWARD, cancelling the wrong class dates
      // and resurrecting the ones the user had cancelled.
      const delta = isoDayDiff(splitIso, isoDayInTz(v.startsAt, event.tz));
      // Deletes target the OLD event id and inserts the NEW one, so the two
      // never collide — one delete for the whole moved range is equivalent to
      // the per-row deletes it replaces, and is one round trip instead of N.
      statements.push(
        db
          .delete(occurrences)
          .where(
            and(
              eq(occurrences.eventId, event.id),
              gte(occurrences.occurrenceDate, splitIso),
            ),
          ),
      );
      for (const row of movedRows) {
        const rowDow =
          (new Date(`${row.occurrenceDate}T12:00:00Z`).getUTCDay() + 6) % 7;
        const newDate =
          delta !== 0 && rowDow === fromDow
            ? shiftIsoDate(row.occurrenceDate, delta)
            : row.occurrenceDate;
        // Two rows can land on one date (e.g. BYDAY=MO,TU with Monday moved
        // onto Tuesday) — merge instead of throwing a PK violation mid-split.
        statements.push(
          db
            .insert(occurrences)
            .values({ ...row, eventId: newId, occurrenceDate: newDate })
            .onConflictDoUpdate({
              target: [occurrences.eventId, occurrences.occurrenceDate],
              set: {
                cancelled: sql`${occurrences.cancelled} or excluded.cancelled`,
                completed: sql`${occurrences.completed} or excluded.completed`,
                completedAt: sql`coalesce(${occurrences.completedAt}, excluded.completed_at)`,
                overrides: sql`coalesce(excluded.overrides, ${occurrences.overrides})`,
              },
            }),
        );
      }
    }

    // All or nothing.
    await db.batch(statements as [Batchable, ...Batchable[]]);

    // Reminder jobs are derived state, rebuilt from scratch on the next sync
    // or by the nightly sweep — safe to do after the batch, since a failure
    // here delays a notification rather than corrupting the calendar.
    await syncJobsForEvent(newId);
  }
  await log(userId, "event_edited", event.id, { title: v.title, scope: v.scope });
  await syncJobsForEvent(event.id);
  refresh();
  return {};
}

const RRULE_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** Monday=0 weekday of an instant, evaluated in the event's timezone. */
function weekdayInTz(d: Date, tz: string): number {
  return (toFloating(d, tz).getUTCDay() + 6) % 7;
}

/** The un-moved instant of an occurrence: its date + the series' wall time. */
function originalSlot(occurrenceDate: string, seriesStart: Date, tz: string): Date {
  const f = toFloating(seriesStart, tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return fromFloating(
    new Date(
      `${occurrenceDate}T${p(f.getUTCHours())}:${p(f.getUTCMinutes())}:${p(f.getUTCSeconds())}Z`,
    ),
    tz,
  );
}

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
    const splitStart = originalSlot(v.occurrenceDate, event.startsAt!, event.tz);
    const until = untilBefore(
      { id: event.id, startsAt: event.startsAt!, endsAt: event.endsAt, rrule: event.rrule, tz: event.tz },
      splitStart,
    );
    if (until) {
      // Trimming the rule isn't enough: an occurrence the user had MOVED
      // (overrides.startsAt) is re-emitted unconditionally by expandEvent,
      // so it would haunt the calendar forever after the series was deleted
      // out from under it. Clear everything at/after the split — in the SAME
      // batch as the trim, or a failure between the two leaves exactly that
      // ghost behind with no series to explain it.
      const splitIso = isoDayInTz(splitStart, event.tz);
      await db.batch([
        db
          .update(events)
          .set({ rrule: withUntil(event.rrule, until), updatedAt: new Date() })
          .where(eq(events.id, event.id)),
        db
          .delete(occurrences)
          .where(
            and(
              eq(occurrences.eventId, event.id),
              gte(occurrences.occurrenceDate, splitIso),
            ),
          ),
      ]);
    } else {
      await db.delete(events).where(eq(events.id, event.id));
    }
  }
  await log(userId, "event_deleted", event.id, { title: event.title, scope: v.scope });
  // Row deletion cascades jobs away; for surviving series (single/future
  // scopes) this re-derives the job set. Orphaned QStash alarms no-op at
  // delivery (job row gone).
  await syncJobsForEvent(event.id);
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
  if (completed) await acknowledgeJobsForEvent(eventId);
  await syncJobsForEvent(eventId);
  refresh();
}

// ---------------------------------------------------------------------------
// Inbox scheduling
// ---------------------------------------------------------------------------

export async function scheduleTask(eventId: string, dueAt: Date): Promise<void> {
  const userId = await requireUserId();
  const due = z.coerce.date().parse(dueAt);
  const event = await ownedEvent(userId, eventId);
  if (event.kind !== "task") throw new Error("Only tasks take a due date");
  await db
    .update(events)
    .set({ dueAt: due, updatedAt: new Date() })
    .where(eq(events.id, event.id));
  await log(userId, "task_scheduled", eventId, { title: event.title });
  await syncJobsForEvent(eventId);
  refresh();
}
