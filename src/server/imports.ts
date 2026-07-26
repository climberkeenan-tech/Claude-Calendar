"use server";

/**
 * Syllabus import lifecycle (ARCHITECTURE §11).
 *
 * The review gate is non-negotiable: extraction stores a PROPOSAL on the
 * import row; only approveImport creates calendar rows — in one atomic
 * batch, every row tagged source='syllabus' + sourceId=importId so undo is
 * one query away.
 */
import { revalidatePath } from "next/cache";
import { and, count, eq, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  activityLog,
  categories,
  courses,
  events,
  reminders,
  syllabusImports,
  userSettings,
} from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";
import { ownedCourseId } from "@/lib/db/ownership";
import { localToInstant } from "@/lib/items/create";
import { fromFloating } from "@/lib/tz";
import { sanitizeRrule } from "@/lib/calendar/sanitize";
import { syncJobsForEvent } from "@/lib/notifications/scheduler";
import {
  deleteStoredFile,
  pathBelongsTo,
  SCOPE_RULES,
  statStoredFile,
} from "@/lib/files/storage";
import type { StoredExtraction } from "@/lib/import/schema";

const TZ = "America/New_York";

const refresh = () => {
  revalidatePath("/import");
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/assignments");
};

// ---------------------------------------------------------------------------
// Register an upload (row creation happens AFTER the browser→Blob upload)
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  url: z.string().url().max(1000),
  pathname: z.string().max(500),
  filename: z.string().trim().min(1).max(200),
});

export async function registerSyllabusUpload(
  input: z.infer<typeof registerSchema>,
): Promise<{ id?: string; error?: string }> {
  const userId = await requireUserId();
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { error: "That upload didn't look right." };
  const v = parsed.data;

  // The browser reported this upload — verify it against the store itself.
  if (!pathBelongsTo(v.pathname, "syllabus", userId)) {
    return { error: "That file doesn't belong to your account." };
  }
  const meta = await statStoredFile(v.url);
  if (!meta || !pathBelongsTo(meta.pathname, "syllabus", userId)) {
    return { error: "Upload not found — try again." };
  }
  const rules = SCOPE_RULES.syllabus;
  if (meta.size > rules.maxBytes || !rules.contentTypes.includes(meta.contentType)) {
    await deleteStoredFile(v.url);
    return { error: "That file type or size isn't supported." };
  }

  const id = crypto.randomUUID();
  await db.insert(syllabusImports).values({
    id,
    userId,
    blobUrl: v.url,
    filename: v.filename,
    mime: meta.contentType,
    status: "uploaded",
  });
  revalidatePath("/import");
  return { id };
}

// ---------------------------------------------------------------------------
// Approve — the ONLY path from proposal to calendar
// ---------------------------------------------------------------------------

const localStamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const approveItemSchema = z.object({
  kind: z.enum(["task", "event"]),
  title: z.string().trim().min(1).max(300),
  startLocal: z.string().regex(localStamp).nullable(),
  /** Last day of an all-day span; nullish means a single day. */
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  durationMinutes: z.number().int().min(5).max(1440).nullable(),
  dueLocal: z.string().regex(localStamp).nullable(),
  allDay: z.boolean(),
  rrule: z.string().max(250).nullable(),
  categoryName: z.string().max(60).nullable(),
  notes: z.string().max(2000).nullable(),
});

const approveSchema = z.object({
  importId: z.string(),
  course: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("link"), courseId: z.string() }),
      z.object({
        mode: z.literal("create"),
        name: z.string().trim().min(1).max(200),
        code: z.string().trim().max(40).nullable(),
        professor: z.string().trim().max(200).nullable(),
        location: z.string().trim().max(200).nullable(),
        term: z.string().trim().max(60).nullable(),
      }),
    ])
    .nullable(),
  items: z.array(approveItemSchema).max(300),
});

const COURSE_COLORS = [
  "#6A9BCC", "#7FA65A", "#D97757", "#9B7EC7",
  "#C7A252", "#5AA6A0", "#BF6E8F", "#8A8F5C",
];

/** Longest all-day span an import may create. A break is a week or two; a
 * model that reads "Spring 2027" as an end date shouldn't blank out a year. */
const MAX_SPAN_DAYS = 60;

/** All-day = local midnight to the local midnight AFTER the last day
 * (DST-safe, same math as the quick-add core). `lastDayIso` makes it span:
 * "Fall Break Oct 12–16" is one five-day block, not a single Monday. */
function allDayRange(
  dayIso: string,
  lastDayIso?: string | null,
): { startsAt: Date; endsAt: Date } {
  const dayMs = 24 * 60 * 60 * 1000;
  const startNoon = new Date(`${dayIso}T12:00:00Z`).getTime();
  const spanDays =
    lastDayIso && lastDayIso > dayIso
      ? Math.min(
          MAX_SPAN_DAYS,
          Math.round((new Date(`${lastDayIso}T12:00:00Z`).getTime() - startNoon) / dayMs),
        )
      : 0;
  // endsAt is exclusive, so a span runs to the morning after its last day.
  const nextIso = new Date(startNoon + (spanDays + 1) * dayMs)
    .toISOString()
    .slice(0, 10);
  return {
    startsAt: fromFloating(new Date(`${dayIso}T00:00:00Z`), TZ),
    endsAt: fromFloating(new Date(`${nextIso}T00:00:00Z`), TZ),
  };
}

export type ApproveResult = { ok?: boolean; created?: number; error?: string };

export async function approveImport(input: unknown): Promise<ApproveResult> {
  const userId = await requireUserId();
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { error: "Some items had invalid dates — check the flagged rows." };
  const v = parsed.data;

  const importRows = await db
    .select()
    .from(syllabusImports)
    .where(and(eq(syllabusImports.id, v.importId), eq(syllabusImports.userId, userId)));
  const importRow = importRows[0];
  if (!importRow) return { error: "Import not found." };
  if (importRow.status === "approved") {
    return { error: "This import was already approved — undo it first to re-import." };
  }
  if (importRow.status !== "review") {
    return { error: "This import isn't ready to approve yet." };
  }
  if (v.items.length === 0 && v.course === null) {
    return { error: "Nothing selected — accept at least one item." };
  }

  // Per-item invariants (kind rules from ARCHITECTURE §4).
  for (const item of v.items) {
    if (item.kind === "task" && !item.dueLocal) {
      return { error: `"${item.title}" needs a due date.` };
    }
    if (item.kind === "event" && !item.startLocal) {
      return { error: `"${item.title}" needs a date.` };
    }
    // The review screen showed a "↻ repeats" chip for this row and the student
    // approved it on that basis. A rule sanitizeRrule can't store used to be
    // written as rrule=null with approve still returning ok — one meeting on
    // the calendar where a semester was promised, and nothing said so. Refuse
    // instead, while nothing has been written.
    if (item.kind === "event" && item.rrule && !sanitizeRrule(item.rrule)) {
      return {
        error: `"${item.title}" has a repeat rule we can't store. Turn off "repeats" on that row to import it as a single date.`,
      };
    }
  }

  // Resolve shared context in one pass: categories by name, reminder defaults.
  const [cats, settingsRows, existingCourses] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.userId, userId)),
    db
      .select({ defaults: userSettings.defaultReminders })
      .from(userSettings)
      .where(eq(userSettings.userId, userId)),
    db.select({ id: courses.id }).from(courses).where(eq(courses.userId, userId)),
  ]);
  const catByName = new Map(cats.map((c) => [c.name, c.id]));
  const reminderDefaults = settingsRows[0]?.defaults ?? {};

  // Course: link (ownership-checked) or create (tagged to this import).
  let courseId: string | null = null;
  let createdCourseId: string | undefined;
  let courseInsert: typeof courses.$inferInsert | null = null;
  if (v.course?.mode === "link") {
    courseId = await ownedCourseId(userId, v.course.courseId);
    if (!courseId) return { error: "That course no longer exists." };
  } else if (v.course?.mode === "create") {
    courseId = crypto.randomUUID();
    createdCourseId = courseId;
    courseInsert = {
      id: courseId,
      userId,
      name: v.course.name,
      code: v.course.code,
      professor: v.course.professor,
      location: v.course.location,
      term: v.course.term,
      color: COURSE_COLORS[existingCourses.length % COURSE_COLORS.length],
      sourceImportId: v.importId,
    };
  }

  // Build every row up front; write them in ONE batch (single transaction on
  // neon-http) — approval is all-or-nothing by construction.
  const eventRows: (typeof events.$inferInsert)[] = [];
  const reminderRows: (typeof reminders.$inferInsert)[] = [];

  for (const item of v.items) {
    const id = crypto.randomUUID();
    let startsAt: Date | null = null;
    let endsAt: Date | null = null;
    let dueAt: Date | null = null;
    let rrule: string | null = null;

    if (item.kind === "task") {
      dueAt = localToInstant(item.dueLocal!);
    } else if (item.allDay) {
      ({ startsAt, endsAt } = allDayRange(
        item.startLocal!.slice(0, 10),
        item.endDate,
      ));
      rrule = sanitizeRrule(item.rrule);
    } else {
      startsAt = localToInstant(item.startLocal!);
      endsAt = new Date(startsAt.getTime() + (item.durationMinutes ?? 60) * 60_000);
      rrule = sanitizeRrule(item.rrule);
    }

    const categoryId = item.categoryName
      ? (catByName.get(item.categoryName) ?? null)
      : null;

    eventRows.push({
      id,
      userId,
      title: item.title,
      notes: item.notes,
      kind: item.kind,
      categoryId,
      courseId,
      startsAt,
      endsAt,
      allDay: item.kind === "event" && item.allDay,
      dueAt,
      rrule,
      tz: TZ,
      source: "syllabus",
      sourceId: v.importId,
    });

    // Same default-reminder policy as quick add: per-category, max 2.
    const offsets = item.categoryName
      ? (reminderDefaults[item.categoryName] ?? []).slice(0, 2)
      : [];
    for (const offsetMinutes of offsets) {
      reminderRows.push({
        id: crypto.randomUUID(),
        eventId: id,
        offsetMinutes,
        channels: ["push"],
      });
    }
  }

  const extraction = {
    ...((importRow.extraction ?? {}) as StoredExtraction),
    createdCourseId,
    approvedEventCount: eventRows.length,
  };

  type Batchable = Parameters<typeof db.batch>[0][number];
  const statements: Batchable[] = [];
  if (courseInsert) statements.push(db.insert(courses).values(courseInsert));
  if (eventRows.length > 0) statements.push(db.insert(events).values(eventRows));
  if (reminderRows.length > 0)
    statements.push(db.insert(reminders).values(reminderRows));
  statements.push(
    db.insert(activityLog).values({
      id: crypto.randomUUID(),
      userId,
      type: "syllabus_imported",
      entityType: "syllabus_import",
      entityId: v.importId,
      data: { filename: importRow.filename, count: eventRows.length },
    }),
  );
  statements.push(
    db
      .update(syllabusImports)
      .set({ status: "approved", courseId, extraction, error: null })
      .where(eq(syllabusImports.id, v.importId)),
  );
  await db.batch(statements as [Batchable, ...Batchable[]]);

  // Materialize notification jobs AFTER the atomic write — this half is
  // idempotent and self-healing (the nightly sweep re-derives job sets), so
  // a crash here can't strand a half-imported semester.
  for (let i = 0; i < eventRows.length; i += 8) {
    await Promise.all(
      eventRows.slice(i, i + 8).map((row) => syncJobsForEvent(row.id!)),
    );
  }

  refresh();
  return { ok: true, created: eventRows.length };
}

// ---------------------------------------------------------------------------
// Undo — remove exactly this import's rows
// ---------------------------------------------------------------------------

export async function undoImport(importId: string): Promise<ApproveResult> {
  const userId = await requireUserId();
  const rows = await db
    .select()
    .from(syllabusImports)
    .where(and(eq(syllabusImports.id, importId), eq(syllabusImports.userId, userId)));
  const importRow = rows[0];
  if (!importRow) return { error: "Import not found." };
  if (importRow.status !== "approved") return { error: "Nothing to undo." };

  const extraction = (importRow.extraction ?? {}) as StoredExtraction;

  // A course this import created goes too — unless the user has since hung
  // their OWN events on it. Asked before any write, and phrased as "events on
  // this course that did not come from this import", so the answer doesn't
  // depend on the delete below having already happened. That ordering is what
  // lets the whole undo go out as one batch.
  let dropCourse = false;
  if (extraction.createdCourseId) {
    const foreign = await db
      .select({ n: count() })
      .from(events)
      .where(
        and(
          eq(events.courseId, extraction.createdCourseId),
          // isNull FIRST, and not for tidiness: an event the user made
          // themselves has sourceId NULL, and `NULL <> 'imp'` is NULL, not
          // true — so a bare ne() counts zero foreign events and drops the
          // course out from under everything the user attached to it.
          or(isNull(events.sourceId), ne(events.sourceId, importId)),
        ),
      );
    dropCourse = (foreign[0]?.n ?? 0) === 0;
  }

  const rest = { ...extraction };
  delete rest.createdCourseId;
  delete rest.approvedEventCount;

  type Batchable = Parameters<typeof db.batch>[0][number];
  const statements: Batchable[] = [
    // Row deletion cascades reminders/occurrences/jobs away; orphaned QStash
    // alarms no-op at delivery (job row gone) — same contract as deleteEvent.
    db
      .delete(events)
      .where(and(eq(events.userId, userId), eq(events.sourceId, importId))),
  ];
  if (dropCourse && extraction.createdCourseId) {
    statements.push(
      db
        .delete(courses)
        .where(
          and(
            eq(courses.id, extraction.createdCourseId),
            eq(courses.userId, userId),
          ),
        ),
    );
  }
  statements.push(
    db
      .update(syllabusImports)
      .set({ status: "review", courseId: null, extraction: rest })
      .where(eq(syllabusImports.id, importId)),
    db.insert(activityLog).values({
      id: crypto.randomUUID(),
      userId,
      type: "syllabus_import_undone",
      entityType: "syllabus_import",
      entityId: importId,
      data: { filename: importRow.filename },
    }),
  );
  // Either the whole import is undone or none of it is — a half-undo leaves
  // events the review screen says were removed.
  await db.batch(statements as [Batchable, ...Batchable[]]);

  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Delete an un-approved upload (file + row)
// ---------------------------------------------------------------------------

export async function deleteImport(importId: string): Promise<void> {
  const userId = await requireUserId();
  const rows = await db
    .select({ blobUrl: syllabusImports.blobUrl, status: syllabusImports.status })
    .from(syllabusImports)
    .where(and(eq(syllabusImports.id, importId), eq(syllabusImports.userId, userId)));
  const row = rows[0];
  if (!row) return;
  if (row.status === "approved") {
    throw new Error("Undo this import before deleting it.");
  }
  await deleteStoredFile(row.blobUrl);
  await db.delete(syllabusImports).where(eq(syllabusImports.id, importId));
  revalidatePath("/import");
}
