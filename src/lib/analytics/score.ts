/**
 * The productivity score (ARCHITECTURE §8) — ONE documented, unit-tested
 * function, always explainable in the UI.
 *
 * Guardrails, by design and treated as law:
 *  - Computed WEEKLY, never as a daily judgment.
 *  - A component with no underlying data DROPS OUT and the remaining
 *    weights renormalize — an unused timer is a tracking gap, not a
 *    productivity failure.
 *  - Presented as "wins + one next action" first; the number is secondary.
 *  - The tile is hideable everywhere it appears.
 */

export type WeekScoreInput = {
  /** Sums over the score week (rolled-up days + live today). */
  tasksCompleted: number;
  tasksCompletedLate: number;
  /** Tasks that came due in the week and weren't done by end of their day. */
  tasksMissed: number;
  focusMinutes: number;
  /** Personal daily target (settings); null = no target chosen. */
  focusTargetMinutesPerDay: number | null;
  /** One entry per active habit: completions this week vs weekly target. */
  habits: { done: number; target: number }[];
  /** Open tasks currently past their due date (live, right now). */
  openOverdueNow: number;
  /** Does this user use tasks at all? Gates the overdue component. */
  usesTasks: boolean;
  /** Days of the week elapsed so far (1–7). Accrual targets (focus, habits)
   * prorate by this — a perfect Monday scores 100, not 14. */
  daysElapsed: number;
};

export type ScorePart = {
  key: "onTime" | "focus" | "habits" | "overdue";
  label: string;
  /** Architecture weights: 40 / 25 / 20 / 15. */
  weight: number;
  /** 0–1 contribution before weighting. */
  value: number;
  /** Human sentence for the "how is this calculated" disclosure. */
  detail: string;
};

export type WeekScore = {
  /** null = not enough data for ANY component (brand-new account). */
  score: number | null;
  parts: ScorePart[];
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Fallback daily focus target when the user hasn't picked one but does use
 * the timer — modest on purpose (an hour of tracked focus is a real day). */
export const DEFAULT_FOCUS_TARGET_PER_DAY = 60;

export function weeklyScore(input: WeekScoreInput): WeekScore {
  const parts: ScorePart[] = [];
  const elapsed = Math.min(7, Math.max(1, input.daysElapsed));

  // On-time completion (40%) — needs something to have been due or done.
  const denom = input.tasksCompleted + input.tasksMissed;
  if (denom > 0) {
    const onTime = Math.max(0, input.tasksCompleted - input.tasksCompletedLate);
    parts.push({
      key: "onTime",
      label: "On-time completion",
      weight: 0.4,
      value: clamp01(onTime / denom),
      detail: `${onTime} of ${denom} finished on time`,
    });
  }

  // Focus vs target (25%) — drops out entirely when the timer went unused.
  // Prorated: graded against the target for the days elapsed so far.
  if (input.focusMinutes > 0) {
    const perDay = input.focusTargetMinutesPerDay ?? DEFAULT_FOCUS_TARGET_PER_DAY;
    const target = perDay * elapsed;
    parts.push({
      key: "focus",
      label: "Focus time",
      weight: 0.25,
      value: clamp01(input.focusMinutes / target),
      detail: `${input.focusMinutes} of ${target} focus minutes expected by now`,
    });
  }

  // Habit adherence (20%) — weekly targets, never streaks. Graded against
  // the pace for days elapsed ("2 of 3 by Wednesday is on track"), while the
  // detail line stays honest about the full weekly target.
  if (input.habits.length > 0) {
    const per = input.habits.map((h) =>
      clamp01(h.done / Math.max(0.5, (Math.max(1, h.target) * elapsed) / 7)),
    );
    const avg = per.reduce((a, b) => a + b, 0) / per.length;
    const met = input.habits.filter(
      (h) => h.done >= Math.max(1, h.target),
    ).length;
    const onPace = input.habits.filter(
      (h, idx) => per[idx] >= 1 || h.done >= Math.max(1, h.target),
    ).length;
    parts.push({
      key: "habits",
      label: "Habits",
      weight: 0.2,
      value: clamp01(avg),
      detail:
        elapsed < 7
          ? `${onPace} of ${input.habits.length} on pace for the week`
          : `${met} of ${input.habits.length} weekly targets met`,
    });
  }

  // Overdue pressure (15%, inverse) — only meaningful for task users.
  if (input.usesTasks) {
    parts.push({
      key: "overdue",
      label: "Overdue pressure",
      weight: 0.15,
      value: clamp01(1 - input.openOverdueNow / 3),
      detail:
        input.openOverdueNow === 0
          ? "Nothing overdue right now"
          : `${input.openOverdueNow} overdue right now`,
    });
  }

  if (parts.length === 0) return { score: null, parts };

  // Renormalize: missing components redistribute their weight instead of
  // silently scoring as zero.
  const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
  const weighted = parts.reduce((a, p) => a + p.weight * p.value, 0);
  return { score: Math.round((weighted / totalWeight) * 100), parts };
}

/**
 * The default presentation: wins first, then exactly ONE next action —
 * "here's a move", never a diagnosis.
 */
export function winsAndNextAction(
  input: WeekScoreInput,
  parts: ScorePart[],
): { wins: string[]; nextAction: string } {
  const wins: string[] = [];
  const onTimeCount = Math.max(0, input.tasksCompleted - input.tasksCompletedLate);

  if (input.tasksCompleted > 0 && input.tasksCompletedLate === 0 && input.tasksMissed === 0) {
    wins.push(
      input.tasksCompleted === 1
        ? "The one thing due got done on time"
        : `All ${input.tasksCompleted} finished tasks landed on time`,
    );
  } else if (onTimeCount >= 3) {
    wins.push(`${onTimeCount} tasks done on time this week`);
  } else if (input.tasksCompleted > 0) {
    wins.push(
      `${input.tasksCompleted} task${input.tasksCompleted === 1 ? "" : "s"} finished this week`,
    );
  }

  const focusPart = parts.find((p) => p.key === "focus");
  if (focusPart && focusPart.value >= 1) {
    wins.push(
      input.daysElapsed >= 7
        ? "Focus target hit for the week"
        : "On pace for your weekly focus target",
    );
  } else if (input.focusMinutes >= 120) {
    wins.push(`${Math.round(input.focusMinutes / 60)}h of tracked focus`);
  }

  const habitsMet = input.habits.filter((h) => h.done >= Math.max(1, h.target));
  if (input.habits.length > 0 && habitsMet.length === input.habits.length) {
    wins.push("Every habit target met");
  }

  // One next action — aimed at the weakest present component.
  let nextAction = "Nothing needs attention — keep it rolling.";
  const weakest = [...parts].sort((a, b) => a.value - b.value)[0];
  if (weakest && weakest.value < 0.99) {
    switch (weakest.key) {
      case "overdue":
        nextAction =
          input.openOverdueNow === 1
            ? "One overdue task — knock it out and the board is clean."
            : "Pick the quickest overdue task and clear it first.";
        break;
      case "onTime":
        nextAction = "Due dates keep slipping past — want a 25-minute starter block tomorrow?";
        break;
      case "focus":
        nextAction = "A single 25-minute focus session today moves this.";
        break;
      case "habits": {
        const behind = input.habits.find((h) => h.done < Math.max(1, h.target));
        nextAction = behind
          ? "One habit check-in today keeps the week on target."
          : "Nothing needs attention — keep it rolling.";
        break;
      }
    }
  }

  return { wins: wins.slice(0, 2), nextAction };
}
