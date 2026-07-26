// English only. The package root pulls all fourteen locale parsers into the
// client bundle, and this runs on every keystroke of a global dialog that's
// mounted on every page in the app.
import { parse as chronoParse } from "chrono-node/en";
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

/**
 * The end of the local day an instant falls on.
 *
 * "Essay due Friday" names a DAY, not a moment, and chrono fills the moment in
 * with whatever the reference time was — noon for a bare weekday. So the task
 * was stored as due at 12:00 and the app called it overdue from 12:01 PM, for
 * the entire afternoon and evening it was actually still due. The dialog's
 * manual path has always used 23:59 for a dateless deadline; this makes the
 * typed path agree.
 */
function endOfLocalDay(d: Date): Date {
  const p = (n: number) => String(n).padStart(2, "0");
  const dayIso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return instantFromWallClock(dayIso, "23:59");
}

/**
 * chrono resolves a bare hour to AM: "gym at 5" books 5:00 in the morning,
 * "dinner at 6" books breakfast. For a student, an unqualified 1–7 means the
 * afternoon or evening essentially every time; 8–12 stays as written, because
 * "class at 9" really is 9 AM on a campus. Only applied when the meridiem is
 * genuinely unstated — "5am" and ranges ending in "pm" already carry it.
 */
const PM_ASSUMED_FROM = 1;
const PM_ASSUMED_THROUGH = 7;

function wantsAfternoon(hour: number, certainMeridiem: boolean): boolean {
  return (
    !certainMeridiem && hour >= PM_ASSUMED_FROM && hour <= PM_ASSUMED_THROUGH
  );
}

/**
 * Did the user actually name a day? chrono marks `day`/`weekday`/`month` as
 * certain only when the text said so ("Friday", "tomorrow", "Sep 20"). A bare
 * "at 5" leaves only `hour` certain, which means chrono picked the DAY itself
 * using forwardDate.
 */
function dayWasInferred(c: {
  isCertain: (component: "day" | "weekday" | "month") => boolean;
}): boolean {
  return !c.isCertain("day") && !c.isCertain("weekday") && !c.isCertain("month");
}

/**
 * Re-run chrono's forward-date decision after the hour has been corrected.
 *
 * This is the whole subtlety. chrono reads "gym at 5" as 5 AM, sees 5 AM today
 * has passed, and rolls it to TOMORROW. Bumping the hour to 5 PM afterwards
 * leaves it on tomorrow — so "gym at 5" landed a day later than "gym at 5pm",
 * from the same words, which is worse than the original AM problem. Once the
 * hour is right, the earliest day that is still in the future is the answer.
 */
function soonestFutureDay(shifted: Date, reference: Date): Date {
  const out = new Date(shifted);
  for (let guard = 0; guard < 400; guard++) {
    const prev = new Date(out);
    prev.setDate(prev.getDate() - 1);
    if (prev.getTime() <= reference.getTime()) break;
    out.setTime(prev.getTime());
  }
  return out;
}

/** Local parse: chrono for dates/times + small patterns for recurrence. */
export function parseLocal(text: string, now: Date = new Date()): ParsedDraft {
  let title = text.trim();
  let startIso: string | null = null;
  let endIso: string | null = null;
  /** End of the named day — the deadline a date-only task really means. */
  let dayEndIso: string | null = null;
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
  const reference = profileReference(now);
  const results = chronoParse(title, reference, { forwardDate: true });
  if (results.length > 0) {
    const r = results[0];
    const certainTime = r.start.isCertain("hour");

    // Correct the hour first, THEN re-decide the day: doing it the other way
    // round is what made "gym at 5" land a day after "gym at 5pm".
    let localStart = r.start.date();
    if (wantsAfternoon(localStart.getHours(), r.start.isCertain("meridiem"))) {
      localStart = new Date(localStart);
      localStart.setHours(localStart.getHours() + 12);
      if (dayWasInferred(r.start)) {
        localStart = soonestFutureDay(localStart, reference);
      }
    }

    let localEnd = r.end ? r.end.date() : null;
    if (localEnd) {
      // Keep the range's shape: move the end by whatever the start moved, so
      // "6:30–8pm" stays 90 minutes rather than being re-derived independently.
      const dayShiftMs = localStart.getTime() - r.start.date().getTime();
      localEnd = new Date(localEnd.getTime() + dayShiftMs);
      // "9am to 5" — chrono reads the end as 5 AM and, since that precedes the
      // start, pushes it to the NEXT day, turning a 9-to-5 into a 20-hour
      // block. When the end's meridiem is unstated, a same-day afternoon
      // reading beats a next-day morning one.
      //
      // The guard `after the start` is what keeps a genuine overnight range
      // ("10pm to 2") alone: 2 PM on the start's day is BEFORE 10 PM, so the
      // candidate is rejected and chrono's next-day 2 AM stands.
      if (!r.end!.isCertain("meridiem")) {
        const sameDayPm = new Date(localStart);
        sameDayPm.setHours(
          localEnd.getHours() + 12,
          localEnd.getMinutes(),
          localEnd.getSeconds(),
          0,
        );
        if (
          sameDayPm.getTime() > localStart.getTime() &&
          sameDayPm.getTime() < localEnd.getTime()
        ) {
          localEnd = sameDayPm;
        }
      }
    }

    const start = reanchor(localStart);
    if (certainTime) {
      startIso = start.toISOString();
      if (localEnd) endIso = reanchor(localEnd).toISOString();
    } else {
      // Date only — all-day (or a due date for tasks)
      startIso = start.toISOString();
      dayEndIso = endOfLocalDay(localStart).toISOString();
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
    // A named day means the END of that day, not the noon chrono filled in.
    dueIso: isTask ? (dayEndIso ?? startIso) : null,
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
