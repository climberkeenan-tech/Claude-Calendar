/**
 * Pure mapping from extraction items to reviewable/creatable drafts.
 * No I/O — unit-tested directly. The review screen edits ReviewDrafts; the
 * approve action turns accepted drafts into event rows.
 */
import type {
  SyllabusCourse,
  SyllabusItem,
  SyllabusItemKind,
} from "./schema";

export type ReviewDraft = {
  key: string;
  accepted: boolean;
  /** Our calendar kinds — syllabus kinds collapse into deadline vs block. */
  kind: "task" | "event";
  title: string;
  date: string | null; // YYYY-MM-DD
  /** Last day of a multi-day all-day span ("Fall Break Oct 12–16"). Only set
   * for non-recurring items — on a recurring one endDate bounds the rule. */
  endDate: string | null;
  startTime: string | null; // HH:MM — null on tasks means 23:59 due time
  durationMinutes: number | null;
  allDay: boolean;
  rrule: string | null;
  categoryName: string | null;
  notes: string | null;
  confidence: number;
  sourceExcerpt: string;
  originalKind: SyllabusItemKind;
};

/** Deadline-shaped things become tasks; time-block things become events. */
export const KIND_TO_EVENT_KIND: Record<SyllabusItemKind, "task" | "event"> = {
  assignment: "task",
  project: "task",
  reading: "task",
  class_session: "event",
  exam: "event",
  lab: "event",
  holiday: "event",
  other: "event",
};

const KIND_TO_CATEGORY: Record<SyllabusItemKind, string | null> = {
  assignment: "Homework",
  project: "Homework",
  reading: "Classes",
  class_session: "Classes",
  lab: "Classes",
  exam: "Exams",
  holiday: "Personal",
  other: null,
};

/** Sensible block lengths when the syllabus gives a start but no end. */
const DEFAULT_DURATION: Partial<Record<SyllabusItemKind, number>> = {
  class_session: 50,
  lab: 110,
  exam: 120,
  other: 60,
};

export function minutesBetween(start: string, end: string): number | null {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const diff = eh * 60 + em - (sh * 60 + sm);
  return diff > 0 ? diff : null;
}

/** Floating-encoding UNTIL for the end of a local calendar day — matches the
 * convention in calendar/recurrence.ts (fake-UTC == wall clock). */
export function untilForDate(dateIso: string): string {
  return `${dateIso.replace(/-/g, "")}T235959Z`;
}

/** Bound an open-ended rule at a date; leave already-bounded rules alone. */
export function boundRrule(
  rrule: string | null,
  endDateIso: string | null,
): string | null {
  if (!rrule) return null;
  const upper = rrule.toUpperCase();
  if (upper.includes("UNTIL=") || upper.includes("COUNT=")) return rrule;
  if (!endDateIso) return rrule;
  return `${rrule};UNTIL=${untilForDate(endDateIso)}`;
}

export function toReviewDraft(
  item: SyllabusItem,
  index: number,
  course: Pick<SyllabusCourse, "termEnd">,
): ReviewDraft {
  const kind = KIND_TO_EVENT_KIND[item.kind];
  const recurring = kind === "event" && item.rrule !== null && item.date !== null;

  let durationMinutes: number | null = null;
  if (kind === "event" && item.startTime) {
    const raw =
      (item.endTime ? minutesBetween(item.startTime, item.endTime) : null) ??
      DEFAULT_DURATION[item.kind] ??
      60;
    // Clamped here rather than rejected downstream. approveItemSchema bounds
    // duration to 5..1440, and a schema failure fails the ENTIRE import with
    // one generic message — so a syllabus listing a three-minute pop quiz took
    // the whole semester down with it, naming no row.
    durationMinutes = Math.min(1440, Math.max(5, raw));
  }

  return {
    key: `item-${index}`,
    // No date → would land in the Inbox; that's noise at import scale, so it
    // starts unchecked (still one click to opt in).
    accepted: item.date !== null,
    kind,
    title: item.title.trim() || "Untitled",
    date: item.date,
    // On a recurring item endDate bounds the RULE (below); on a one-off it
    // means the span really runs to that day, which used to be thrown away —
    // "Fall Break Oct 12–16" imported as a single Monday.
    endDate: recurring ? null : item.endDate,
    startTime: item.startTime,
    durationMinutes,
    allDay: kind === "event" && (item.kind === "holiday" || !item.startTime),
    rrule: recurring
      ? boundRrule(item.rrule, item.endDate ?? course.termEnd)
      : null,
    categoryName: KIND_TO_CATEGORY[item.kind],
    notes: item.notes,
    confidence: item.confidence,
    sourceExcerpt: item.sourceExcerpt,
    originalKind: item.kind,
  };
}

/** The shape approveImport validates and inserts. */
export type ApproveItem = {
  kind: "task" | "event";
  title: string;
  startLocal: string | null;
  /** Last day of an all-day span; null means a single day. */
  endDate: string | null;
  durationMinutes: number | null;
  dueLocal: string | null;
  allDay: boolean;
  rrule: string | null;
  categoryName: string | null;
  notes: string | null;
};

export function draftToApproveItem(d: ReviewDraft): ApproveItem | null {
  if (!d.date) return null; // dateless items can't be scheduled
  if (d.kind === "task") {
    return {
      kind: "task",
      title: d.title,
      startLocal: null,
      endDate: null, // a deadline is a moment, not a span
      durationMinutes: null,
      // Untimed deadlines mean "that day" — 23:59 keeps them on the right
      // side of midnight without inventing a fake hour.
      dueLocal: `${d.date}T${d.startTime ?? "23:59"}`,
      allDay: false,
      rrule: null,
      categoryName: d.categoryName,
      notes: d.notes,
    };
  }
  return {
    kind: "event",
    title: d.title,
    startLocal: `${d.date}T${d.allDay || !d.startTime ? "00:00" : d.startTime}`,
    // Only an all-day block can span days; a timed one is defined by duration.
    endDate: d.allDay || !d.startTime ? (d.endDate ?? null) : null,
    durationMinutes: d.allDay ? null : d.durationMinutes,
    dueLocal: null,
    allDay: d.allDay || !d.startTime,
    rrule: d.rrule,
    categoryName: d.categoryName,
    notes: d.notes,
  };
}
