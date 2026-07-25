"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ActionError, useActionGuard } from "@/components/ui/action-error";
import { toggleOccurrence } from "@/server/calendar";
import type { HabitWeek } from "@/lib/db/queries/dashboard";
import { fmtIsoDay, isoDay, shiftDay } from "@/lib/time";
import { cn, contrastText } from "@/lib/utils";

/** The --ok green, as a literal: contrastText needs a hex, not a var(). */
const OK_FILL = "#7d9b76";

/**
 * One habit, one week: seven tappable day cells + progress toward the weekly
 * target. Past days can be backfilled; future days are disabled. No streaks,
 * no zeros — “2 of 3” is progress, not a verdict.
 */
export function HabitRow({
  habit,
  weekStartIso,
}: {
  habit: HabitWeek;
  weekStartIso: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const guard = useActionGuard();
  // Pure calendar-date arithmetic — no instants, so nothing to mis-bucket.
  const todayIso = isoDay(new Date());

  const days = Array.from({ length: 7 }, (_, i) => {
    const iso = shiftDay(weekStartIso, i);
    return {
      iso,
      label: fmtIsoDay(iso, { weekday: "narrow" }),
      done: habit.doneDates.includes(iso),
      future: iso > todayIso,
    };
  });

  const doneCount = habit.doneDates.length;
  const met = doneCount >= habit.target;

  return (
    <li className="flex flex-wrap items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{habit.title}</span>
      <div className="flex items-center gap-1" role="group" aria-label={`${habit.title} days`}>
        {days.map((d) => (
          <button
            key={d.iso}
            disabled={d.future || pending}
            aria-pressed={d.done}
            aria-label={`${habit.title} on ${d.iso}${d.done ? " — done" : ""}`}
            onClick={() =>
              startTransition(async () => {
                const ok = await guard.run(
                  () => toggleOccurrence(habit.id, d.iso, !d.done),
                  "Didn't stick — try that day again.",
                );
                if (ok) router.refresh();
              })
            }
            className={cn(
              "flex size-6 items-center justify-center rounded-full border text-[10px] font-medium transition-colors",
              d.done
                ? "border-transparent"
                : d.future
                  ? "border-border text-ink-faint/50"
                  : "border-border-strong text-ink-muted hover:border-ok hover:text-ok-ink",
            )}
            style={
              d.done
                ? {
                    backgroundColor: habit.categoryColor ?? OK_FILL,
                    // White reads at 2.28:1 on the "Work" tan — pick per colour.
                    color: contrastText(habit.categoryColor ?? OK_FILL),
                  }
                : undefined
            }
          >
            {d.label}
          </button>
        ))}
      </div>
      <span
        className={cn(
          "w-12 shrink-0 text-right font-mono text-xs",
          met ? "text-ok-ink" : "text-ink-muted",
        )}
      >
        {doneCount} of {habit.target}
      </span>
      <ActionError message={guard.error} className="basis-full text-xs text-danger-ink" />
    </li>
  );
}
