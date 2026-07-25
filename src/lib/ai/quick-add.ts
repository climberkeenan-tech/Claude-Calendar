import * as chrono from "chrono-node";
import { z } from "zod";
import { instantFromWallClock, wallClockValue } from "@/lib/time";

/**
 * Quick-add parsing (ARCHITECTURE §6): local-first. `parseLocal` runs on every
 * keystroke in the browser — instant chips. The Claude call (see
 * /api/quick-add/parse) reconciles asynchronously: recurrence phrasing,
 * category/kind guesses, and anything chrono can't read.
 */

export type ParsedDraft = {
  title: string;
  kind: "event" | "task" | "habit";
  /** ISO instant, present for timed items */
  startIso: string | null;
  endIso: string | null;
  dueIso: string | null;
  allDay: boolean;
  rrule: string | null;
  /** Human summary of the recurrence ("every Monday") for the chip */
  rruleLabel: string | null;
  categoryName: string | null;
  habitTargetPerWeek: number | null;
  /** Where the guess came from — the UI marks Claude refinements */
  source: "local" | "claude";
};

const WEEKDAYS: Record<string, string> = {
  sunday: "SU",
  monday: "MO",
  tuesday: "TU",
  wednesday: "WE",
  thursday: "TH",
  friday: "FR",
  saturday: "SA",
};

const CATEGORY_HINTS: [RegExp, string][] = [
  [/\b(homework|assignment|problem set|pset|essay|paper|worksheet)\b/i, "Homework"],
  [/\b(exam|midterm|final|quiz|test)\b/i, "Exams"],
  [/\b(class|lecture|lab|seminar|recitation)\b/i, "Classes"],
  [/\b(gym|workout|lift|run|practice|climb|climbing)\b/i, "Practice"],
  [/\b(work|shift|job)\b/i, "Work"],
  [/\b(study|review|read|reading)\b/i, "Classes"],
];

const TASK_HINTS = /\b(due|submit|turn in|finish|hand in|deadline)\b/i;

/**
 * chrono only ever thinks in the *host's* wall clock — it has no idea the
 * profile lives in Eastern. Handing it a reference whose host-local fields
 * already read as profile time makes every relative phrase ("tomorrow",
 * "Friday", "tonight") resolve against the right day, and the components it
 * hands back are then re-anchored in the profile zone below. Without this,
 * typing "class at 9am" from California books 6 AM Eastern.
 */
function profileReference(now: Date): Date {
  return new Date(wallClockValue(now));
}

/** Chrono's result is a host-local Date whose fields ARE the profile wall
 * clock (see `profileReference`) — turn those fields back into a real instant. */
function reanchor(d: Date): Date {
  const p = (n: number) => String(n).padStart(2, "0");
  const dayIso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return instantFromWallClock(dayIso, `${p(d.getHours())}:${p(d.getMinutes())}`);
}

/** Local parse: chrono for dates/times + small patterns for recurrence. */
export function parseLocal(text: string, now: Date = new Date()): ParsedDraft {
  let title = text.trim();
  let startIso: string | null = null;
  let endIso: string | null = null;
  let allDay = false;
  let rrule: string | null = null;
  let rruleLabel: string | null = null;

  // Recurrence: "every Monday (and Wednesday)", "every day", "daily", "weekly"
  const every = /\bevery\s+(day|week)\b|\bevery\s+((?:mon|tues|wednes|thurs|fri|satur|sun)day(?:s)?(?:\s*(?:,|and)\s*(?:mon|tues|wednes|thurs|fri|satur|sun)day(?:s)?)*)\b|\b(daily|weekly)\b/i.exec(
    text,
  );
  if (every) {
    if (every[1]?.toLowerCase() === "day" || every[3]?.toLowerCase() === "daily") {
      rrule = "FREQ=DAILY";
      rruleLabel = "every day";
    } else if (every[1]?.toLowerCase() === "week" || every[3]?.toLowerCase() === "weekly") {
      rrule = "FREQ=WEEKLY";
      rruleLabel = "weekly";
    } else if (every[2]) {
      const days = Object.keys(WEEKDAYS).filter((d) =>
        new RegExp(`\\b${d}s?\\b`, "i").test(every[2]),
      );
      if (days.length > 0) {
        rrule = `FREQ=WEEKLY;BYDAY=${days.map((d) => WEEKDAYS[d]).join(",")}`;
        rruleLabel = `every ${days.map((d) => d[0].toUpperCase() + d.slice(1)).join(" and ")}`;
      }
    }
    if (rrule) title = title.replace(every[0], "").trim();
  }

  // Dates/times via chrono (forwardDate: "Monday" means the coming Monday)
  const results = chrono.parse(title, profileReference(now), { forwardDate: true });
  if (results.length > 0) {
    const r = results[0];
    const start = reanchor(r.start.date());
    const certainTime = r.start.isCertain("hour");
    if (certainTime) {
      startIso = start.toISOString();
      if (r.end) {
        endIso = reanchor(r.end.date()).toISOString();
      }
    } else {
      // Date only — all-day (or a due date for tasks)
      startIso = start.toISOString();
      allDay = true;
    }
    title = (title.slice(0, r.index) + title.slice(r.index + r.text.length))
      .replace(/\s{2,}/g, " ")
      .replace(/\s+(at|on|by|from)\s*$/i, "")
      .trim();
  }

  const isTask = TASK_HINTS.test(text);
  const isHabit = Boolean(rrule) && /\b(gym|workout|run|practice|habit|meditate|read)\b/i.test(text);

  let categoryName: string | null = null;
  for (const [re, cat] of CATEGORY_HINTS) {
    if (re.test(text)) {
      categoryName = cat;
      break;
    }
  }

  title = title.replace(/^[-–—:,.\s]+|[-–—:,.\s]+$/g, "").trim();

  return {
    title: title || text.trim(),
    kind: isHabit ? "habit" : isTask ? "task" : "event",
    startIso: isTask ? null : startIso,
    endIso: isTask ? null : endIso,
    dueIso: isTask ? startIso : null,
    allDay,
    rrule,
    rruleLabel,
    categoryName,
    habitTargetPerWeek: isHabit && rrule?.includes("BYDAY")
      ? rrule.split("BYDAY=")[1].split(",").length
      : isHabit
        ? 7
        : null,
    source: "local",
  };
}

/** Zod schema for Claude's structured output — also validates the API route. */
export const claudeDraftSchema = z.object({
  title: z.string().describe("The event title with date/time words removed"),
  kind: z.enum(["event", "task", "habit"]),
  start: z
    .string()
    .nullable()
    .describe("ISO 8601 local wall-clock start, e.g. 2026-09-14T19:00:00 (no Z), null if unknown"),
  durationMinutes: z.number().int().min(5).max(1440).nullable(),
  due: z
    .string()
    .nullable()
    .describe("ISO 8601 local wall-clock deadline for tasks, null otherwise"),
  allDay: z.boolean(),
  rrule: z
    .string()
    .nullable()
    .describe("RFC 5545 RRULE body like FREQ=WEEKLY;BYDAY=MO, null if not recurring"),
  rruleLabel: z.string().nullable().describe("Short human phrase, e.g. 'every Monday'"),
  categoryName: z
    .enum(["Classes", "Homework", "Exams", "Personal", "Work", "Practice"])
    .nullable(),
  habitTargetPerWeek: z.number().int().min(1).max(7).nullable(),
  confidence: z.number().min(0).max(1),
});

export type ClaudeDraft = z.infer<typeof claudeDraftSchema>;
