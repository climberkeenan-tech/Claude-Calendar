/**
 * Learned patterns, said out loud.
 *
 * `user_patterns` is a JSON blob of ratios and 24-slot histograms. Handing
 * that to Claude raw means it has to do statistics in a sentence, and handing
 * it to the owner means nothing at all. This turns it into claims a person
 * would actually make — and only the ones the data supports.
 *
 * Pure: no database, no clock, no timezone lookups. Every threshold here is a
 * judgement about when a number stops being noise, so they are all named.
 */
import type { UserPatterns } from "@/lib/analytics/patterns";

/** Below this many finished-and-timed items, an estimate ratio is one bad
 * afternoon, not a habit. */
export const MIN_ESTIMATE_SAMPLES = 3;
/** How far off you have to be before it's worth saying. ±15%. */
const ESTIMATE_TOLERANCE = 0.15;
/** A focus window has to hold this share of the week's minutes to be "when
 * you work" rather than "where the mode happened to land". */
const WINDOW_SHARE = 0.3;
/** Reminders below this count can't tell you anything about ignore rate. */
const MIN_REMINDERS = 5;

function hourLabel(h: number): string {
  const suffix = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
}

/**
 * The best contiguous 3-hour window in a 24-slot histogram, or null when the
 * data is too flat or too thin to name one. Exported because "when do I
 * actually get things done" is the single most useful thing here and it
 * deserves its own test.
 */
export function peakWindow(
  hours: number[] | undefined,
): { startHour: number; endHour: number; share: number } | null {
  if (!Array.isArray(hours) || hours.length !== 24) return null;
  const total = hours.reduce((a, b) => a + (Number(b) || 0), 0);
  if (total <= 0) return null;

  let best = { startHour: 0, sum: -1 };
  for (let h = 0; h <= 21; h++) {
    const sum = (hours[h] || 0) + (hours[h + 1] || 0) + (hours[h + 2] || 0);
    if (sum > best.sum) best = { startHour: h, sum };
  }
  const share = best.sum / total;
  if (share < WINDOW_SHARE) return null;

  // Trim empty hours off the ends. Two windows can tie — all the minutes at
  // 8 and 9 PM score the same whether the window is read as 7–10 or 8–11 —
  // and the tie-break would otherwise announce an hour with nothing in it as
  // when you work.
  let startHour = best.startHour;
  let endHour = best.startHour + 3;
  while (startHour < endHour && !(hours[startHour] > 0)) startHour++;
  while (endHour > startHour && !(hours[endHour - 1] > 0)) endHour--;

  return { startHour, endHour, share: Number(share.toFixed(2)) };
}

/**
 * Plain-English lines for whatever the patterns actually support. Returns an
 * empty list when nothing does — silence is the honest answer for a new
 * account, and inventing "you seem productive!" is how a tool loses trust.
 */
export function summarizePatterns(raw: unknown): string[] {
  // `user_patterns.patterns` is an untyped jsonb blob — it is whatever the
  // derivation wrote on whatever night it last ran, including nights before a
  // field existed. Take the shape as a hint and check every value anyway.
  if (!raw || typeof raw !== "object") return [];
  const patterns = raw as Partial<UserPatterns>;
  const lines: string[] = [];

  // --- how long things really take ------------------------------------------
  const accuracy = patterns.estimateAccuracy ?? {};
  const notable = Object.entries(accuracy)
    .filter(
      ([, v]) =>
        v &&
        typeof v.ratio === "number" &&
        Number.isFinite(v.ratio) &&
        (v.samples ?? 0) >= MIN_ESTIMATE_SAMPLES &&
        Math.abs(v.ratio - 1) > ESTIMATE_TOLERANCE,
    )
    .sort((a, b) => Math.abs(b[1].ratio - 1) - Math.abs(a[1].ratio - 1))
    .slice(0, 3);
  for (const [category, v] of notable) {
    lines.push(
      v.ratio > 1
        ? `${category} takes about ${v.ratio.toFixed(1)}× longer than planned (${v.samples} timed items) — pad the estimate.`
        : `${category} finishes faster than planned, about ${v.ratio.toFixed(1)}× the estimate (${v.samples} timed items).`,
    );
  }

  // --- when the work actually happens ---------------------------------------
  const focus = peakWindow(patterns.focusByHour);
  if (focus) {
    lines.push(
      `Focus time clusters between ${hourLabel(focus.startHour)} and ${hourLabel(focus.endHour)} — schedule hard work there.`,
    );
  }
  const done = peakWindow(patterns.completionByHour);
  if (done && (!focus || done.startHour !== focus.startHour)) {
    lines.push(
      `Most things get finished between ${hourLabel(done.startHour)} and ${hourLabel(done.endHour)}.`,
    );
  }

  // --- whether reminders are landing ----------------------------------------
  const r = patterns.reminders;
  if (r && (r.sent ?? 0) >= MIN_REMINDERS) {
    const pct = Math.round((r.ignoreRate ?? 0) * 100);
    if (pct >= 60) {
      lines.push(
        `${pct}% of reminders go unacknowledged — there are probably too many, or they land at the wrong time.`,
      );
    } else if (pct <= 25) {
      lines.push(`Reminders are working: ${100 - pct}% get acknowledged.`);
    }
  }

  // --- deadlines ------------------------------------------------------------
  if ((patterns.lateCompletions ?? 0) > 0) {
    const n = patterns.lateCompletions;
    lines.push(
      `${n} item${n === 1 ? "" : "s"} finished after the due date in the last 30 days.`,
    );
  }
  if ((patterns.totalOpenTasks ?? 0) > 0) {
    lines.push(`${patterns.totalOpenTasks} open task(s) right now.`);
  }

  return lines;
}
