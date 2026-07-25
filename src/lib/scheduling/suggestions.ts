/**
 * Suggestion surfaces (ROADMAP Phase 9): best study time, break timing,
 * sleep consistency, workout slot, deep-work session — each one-click
 * acceptable.
 *
 * Pure and deterministic, like the planner: every suggestion carries the
 * concrete block it would create, so Accept is inspectable rather than
 * magical. Framed as moves, never diagnoses ("your best focus window is
 * open" — never "you wasted the afternoon").
 */
import type { FreeBlock } from "./free-time";

export type SuggestionKind =
  | "best_study_time"
  | "break"
  | "sleep_consistency"
  | "movement"
  | "deep_work";

export type Suggestion = {
  kind: SuggestionKind;
  title: string;
  /** One line of why — always a move, never a verdict. */
  rationale: string;
  start: Date;
  minutes: number;
  /** What the accepted block is called on the calendar. */
  eventTitle: string;
  categoryName: string | null;
};

export type SuggestionInput = {
  now: Date;
  /** Free blocks for the day being suggested into (already buffered). */
  free: FreeBlock[];
  /** Learned focus minutes by local hour, if derived yet. */
  focusByHour: number[] | null;
  hourOf: (d: Date) => number;
  /** Timed commitments today, for break detection. */
  busy: { startsAt: Date; endsAt: Date; title?: string }[];
  /** Existing habit titles — don't suggest what they already track. */
  habitTitles: string[];
  /** Local hour the user's earliest commitment starts across the week,
   * for the sleep-consistency nudge (null when nothing is scheduled). */
  earliestCommitmentHour: number | null;
  /** Minutes already planned today — a packed day gets breaks, not more work. */
  plannedMinutesToday: number;
};

const MIN = 60_000;

function bestHourFrom(focusByHour: number[] | null): number | null {
  if (!focusByHour || focusByHour.every((n) => n === 0)) return null;
  return focusByHour.indexOf(Math.max(...focusByHour));
}

const hourLabel = (h: number) =>
  h === 0 ? "midnight" : h < 12 ? `${h} AM` : h === 12 ? "noon" : `${h - 12} PM`;

/** The first free block that contains `hour` and fits `minutes`. */
function blockAtHour(
  free: FreeBlock[],
  hour: number,
  minutes: number,
  hourOf: (d: Date) => number,
): Date | null {
  for (const b of free) {
    if (b.minutes < minutes) continue;
    // Walk the block in 15-minute steps looking for the target hour.
    for (let t = b.start.getTime(); t + minutes * MIN <= b.end.getTime(); t += 15 * MIN) {
      if (hourOf(new Date(t)) === hour) return new Date(t);
    }
  }
  return null;
}

function longestBlock(free: FreeBlock[]): FreeBlock | null {
  return free.reduce<FreeBlock | null>(
    (best, b) => (!best || b.minutes > best.minutes ? b : best),
    null,
  );
}

export function buildSuggestions(i: SuggestionInput): Suggestion[] {
  const out: Suggestion[] = [];
  const usable = i.free.filter((b) => b.end.getTime() > i.now.getTime() + 30 * MIN);
  const has = (needle: string) =>
    i.habitTitles.some((t) => t.toLowerCase().includes(needle));

  // 1. Best study time — your own peak hour, if it's actually open.
  const peak = bestHourFrom(i.focusByHour);
  if (peak !== null && i.plannedMinutesToday < 180) {
    const at = blockAtHour(usable, peak, 50, i.hourOf);
    if (at) {
      out.push({
        kind: "best_study_time",
        title: `Your ${hourLabel(peak)} focus window is open`,
        rationale: "This is when your finished sessions cluster — worth claiming.",
        start: at,
        minutes: 50,
        eventTitle: "Focus block",
        categoryName: "Classes",
      });
    }
  }

  // 2. Break timing — a long unbroken run of commitments deserves one.
  const sorted = [...i.busy].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  let runStart: Date | null = null;
  let runEnd: Date | null = null;
  for (const b of sorted) {
    if (!runStart || !runEnd) {
      runStart = b.startsAt;
      runEnd = b.endsAt;
      continue;
    }
    if (b.startsAt.getTime() - runEnd.getTime() <= 20 * MIN) {
      runEnd = new Date(Math.max(runEnd.getTime(), b.endsAt.getTime()));
    } else {
      break;
    }
  }
  if (runStart && runEnd && runEnd.getTime() - runStart.getTime() >= 3 * 60 * MIN) {
    const after = usable.find((b) => b.start.getTime() >= runEnd!.getTime());
    if (after && after.minutes >= 15) {
      out.push({
        kind: "break",
        title: "Block a real break after that run",
        rationale: `${Math.round((runEnd.getTime() - runStart.getTime()) / MIN / 60)} straight hours booked — 20 minutes off keeps the evening usable.`,
        start: after.start,
        minutes: 20,
        eventTitle: "Break",
        categoryName: "Personal",
      });
    }
  }

  // 3. Deep work — one genuinely long stretch, if the day has one.
  const longest = longestBlock(usable);
  if (longest && longest.minutes >= 150 && i.plannedMinutesToday < 120) {
    out.push({
      kind: "deep_work",
      title: `${Math.floor(longest.minutes / 60)}h clear — good for the hard thing`,
      rationale: "Your longest uninterrupted stretch today. Big tasks fit here.",
      start: longest.start,
      minutes: 90,
      eventTitle: "Deep work",
      categoryName: "Homework",
    });
  }

  // 4. Movement — only if they aren't already tracking it as a habit.
  if (!has("gym") && !has("run") && !has("workout") && !has("lift")) {
    const at = blockAtHour(usable, 17, 45, i.hourOf) ?? blockAtHour(usable, 16, 45, i.hourOf);
    if (at) {
      out.push({
        kind: "movement",
        title: "45 minutes free at 5 — enough to move",
        rationale: "Late-afternoon gaps are the easiest to actually use.",
        start: at,
        minutes: 45,
        eventTitle: "Workout",
        categoryName: "Personal",
      });
    }
  }

  // 5. Sleep consistency — a wind-down anchored to the earliest thing you
  //    have to be awake for. Never framed as a scolding.
  if (i.earliestCommitmentHour !== null && i.earliestCommitmentHour <= 9) {
    const at = blockAtHour(usable, 22, 30, i.hourOf) ?? blockAtHour(usable, 21, 30, i.hourOf);
    if (at && !has("sleep") && !has("bed")) {
      out.push({
        kind: "sleep_consistency",
        title: "Wind-down at 10 keeps the early start survivable",
        rationale: `Your earliest commitment is around ${hourLabel(i.earliestCommitmentHour)}.`,
        start: at,
        minutes: 30,
        eventTitle: "Wind down",
        categoryName: "Personal",
      });
    }
  }

  // Cap hard: suggestions are a nudge, not a wall of homework.
  return out.slice(0, 3);
}
