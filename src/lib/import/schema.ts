/**
 * Syllabus extraction contract (ARCHITECTURE §11) — the one shape shared by
 * the Claude call (structured output), the stored `extraction` jsonb, the
 * review screen, and the approve action's re-validation.
 */
import { z } from "zod";

export const SYLLABUS_ITEM_KINDS = [
  "class_session",
  "assignment",
  "exam",
  "project",
  "reading",
  "lab",
  "holiday",
  "other",
] as const;
export type SyllabusItemKind = (typeof SYLLABUS_ITEM_KINDS)[number];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const hm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();

export const syllabusItemSchema = z.object({
  kind: z.enum(SYLLABUS_ITEM_KINDS),
  title: z.string().max(300),
  /** First (or only) date, YYYY-MM-DD. Null when the document gives none. */
  date: isoDate,
  /** Last date for ranges/recurring series (e.g. "classes end Dec 4"). */
  endDate: isoDate,
  /** 24h wall-clock America/New_York. Null = all-day / unspecified. */
  startTime: hm,
  endTime: hm,
  /** Recurrence guess, RFC5545 RRULE body (e.g. FREQ=WEEKLY;BYDAY=MO,WE). */
  rrule: z.string().max(200).nullable(),
  notes: z.string().max(1000).nullable(),
  /** 0–1 — the review screen flags anything below 0.8. */
  confidence: z.number(),
  /** Verbatim span from the document this item came from — the review
   * screen's "why does Claude think that" evidence. */
  sourceExcerpt: z.string().max(500),
});
export type SyllabusItem = z.infer<typeof syllabusItemSchema>;

export const syllabusCourseSchema = z.object({
  name: z.string().max(200).nullable(),
  code: z.string().max(40).nullable(),
  professor: z.string().max(200).nullable(),
  location: z.string().max(200).nullable(),
  /** Human-readable meeting pattern, e.g. "MWF 10:00–10:50". */
  meetingTimes: z.string().max(200).nullable(),
  officeHours: z.string().max(300).nullable(),
  term: z.string().max(60).nullable(),
  termStart: isoDate,
  termEnd: isoDate,
  confidence: z.number(),
});
export type SyllabusCourse = z.infer<typeof syllabusCourseSchema>;

export const syllabusExtractionSchema = z.object({
  /** False → friendly "this doesn't look like a syllabus" failure. */
  isSyllabus: z.boolean(),
  documentSummary: z.string().max(400),
  course: syllabusCourseSchema,
  items: z.array(syllabusItemSchema).max(300),
});
export type SyllabusExtraction = z.infer<typeof syllabusExtractionSchema>;

/** What syllabus_imports.extraction actually stores. */
export type StoredExtraction = {
  result: SyllabusExtraction;
  model: string;
  extractedAt: string;
  /** Set on approve so undo can also remove a course this import created. */
  createdCourseId?: string;
  approvedEventCount?: number;
};
