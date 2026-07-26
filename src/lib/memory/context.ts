/**
 * Everything Claude should know before it answers.
 *
 * The complaint this exists to fix: you tell Claude something on Monday and by
 * Wednesday it's asking again. Nine separate tools each returned one slice, so
 * a conversation only knew whatever it had thought to ask for. This is the one
 * call that hands over the whole picture — who you are, what you're taking,
 * what's due, what the app has learned about you, and what you've explicitly
 * asked it to remember.
 *
 * Split in two on purpose: `gatherContext` does the reads, `formatContext` is
 * pure. The formatting is where the wording lives, and wording is the part
 * that's worth testing.
 */
import { and, asc, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { events, userPatterns, users } from "@/lib/db/schema";
import { getCalendarWindow } from "@/lib/db/queries/calendar";
import { listCourses } from "@/lib/db/queries/courses";
import { getSchedulingPrefs, type SchedulingPrefs } from "@/lib/scheduling/context";
import { dayBounds, fmtTime, isoDay, relativeDue } from "@/lib/time";
import { summarizePatterns } from "./summary";
import { memoriesForContext, type Memory } from "./store";

const TZ = "America/New_York";
/** Enough to plan a week without turning the reply into a wall. */
const AGENDA_LIMIT = 25;
const DEADLINE_LIMIT = 20;

export type ContextBundle = {
  name: string | null;
  timezone: string;
  today: string;
  prefs: SchedulingPrefs;
  courses: {
    name: string;
    code: string | null;
    professor: string | null;
    location: string | null;
  }[];
  agenda: { when: string; title: string; category: string | null; done: boolean }[];
  deadlines: { due: string; title: string; id: string }[];
  memories: Memory[];
  learned: string[];
  learnedAt: string | null;
};

export async function gatherContext(userId: string): Promise<ContextBundle> {
  const now = new Date();
  const { start, end } = dayBounds(now);
  const horizon = new Date(now.getTime() + 14 * 24 * 3600_000);

  const [person, courses, dayItems, dueRows, patternRows, prefs, remembered] =
    await Promise.all([
      db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1),
      listCourses(userId),
      getCalendarWindow(userId, start, end),
      db
        .select({ id: events.id, title: events.title, dueAt: events.dueAt })
        .from(events)
        .where(
          and(
            eq(events.userId, userId),
            eq(events.kind, "task"),
            eq(events.status, "scheduled"),
            isNotNull(events.dueAt),
            lt(events.dueAt, horizon),
          ),
        )
        .orderBy(asc(events.dueAt))
        .limit(DEADLINE_LIMIT),
      db.select().from(userPatterns).where(eq(userPatterns.userId, userId)).limit(1),
      getSchedulingPrefs(userId),
      // Reading the memories is what marks them used, so this call has to be
      // the same one the tools make — not a parallel copy that skips the stamp.
      memoriesForContext(userId),
    ]);

  const patterns = patternRows[0]?.patterns ?? null;

  return {
    name: person[0]?.name ?? null,
    timezone: TZ,
    today: isoDay(now),
    prefs,
    courses: courses.map((c) => ({
      name: c.name,
      code: c.code,
      professor: c.professor,
      location: c.location,
    })),
    agenda: dayItems
      .slice()
      .sort(
        (a, b) =>
          (a.startsAt ?? a.dueAt ?? new Date(0)).getTime() -
          (b.startsAt ?? b.dueAt ?? new Date(0)).getTime(),
      )
      .slice(0, AGENDA_LIMIT)
      .map((i) => ({
        when: i.startsAt
          ? fmtTime(i.startsAt)
          : i.dueAt
            ? `due ${fmtTime(i.dueAt)}`
            : "unscheduled",
        title: i.title,
        category: i.categoryName ?? null,
        done: i.completed,
      })),
    deadlines: dueRows.map((r) => ({
      id: r.id,
      title: r.title,
      due: relativeDue(now, r.dueAt!),
    })),
    memories: remembered,
    learned: summarizePatterns(patterns),
    learnedAt: typeof patterns?.computedAt === "string" ? patterns.computedAt : null,
  };
}

/**
 * The brief, as text. Sections that have nothing in them say so rather than
 * disappearing — "no classes set up yet" is information; a missing heading
 * reads as "didn't check".
 */
export function formatContext(b: ContextBundle): string {
  const who = b.name ? `${b.name}, a student at High Point University` : "the owner";
  const out: string[] = [
    `Context for ${who}. Today is ${b.today} (${b.timezone}).`,
    `Waking hours ${b.prefs.dayStart}–${b.prefs.dayEnd}, ${b.prefs.bufferMinutes} min between commitments, at most ${b.prefs.maxPlanMinutesPerDay} min of planned study per day.`,
    "",
    "## Classes",
    b.courses.length === 0
      ? "None set up yet."
      : b.courses
          .map(
            (c) =>
              `- ${c.name}${c.code ? ` (${c.code})` : ""}${c.professor ? ` — ${c.professor}` : ""}${c.location ? `, ${c.location}` : ""}`,
          )
          .join("\n"),
    "",
    "## Today",
    b.agenda.length === 0
      ? "Nothing scheduled."
      : b.agenda
          .map(
            (i) =>
              `- ${i.when} · ${i.title}${i.category ? ` (${i.category})` : ""}${i.done ? " ✓done" : ""}`,
          )
          .join("\n"),
    "",
    "## Coming up (14 days)",
    b.deadlines.length === 0
      ? "No deadlines in that window."
      : b.deadlines.map((d) => `- ${d.due} · ${d.title} [id: ${d.id}]`).join("\n"),
    "",
    "## What the app has learned (recomputed nightly from actual behaviour)",
    b.learned.length === 0
      ? "Not enough history yet."
      : b.learned.map((l) => `- ${l}`).join("\n"),
    "",
    "## What you've been told to remember",
    b.memories.length === 0
      ? "Nothing yet. Use the `remember` tool when they tell you something worth keeping."
      : b.memories.map((m) => `- [${m.kind}] ${m.text}${m.pinned ? " (pinned)" : ""}`).join("\n"),
  ];

  if (b.learnedAt) {
    out.push("", `_Patterns last computed ${b.learnedAt.slice(0, 10)}._`);
  }
  return out.join("\n");
}
