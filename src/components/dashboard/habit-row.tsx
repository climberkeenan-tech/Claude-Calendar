"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toggleOccurrence } from "@/server/calendar";
import type { HabitWeek } from "@/lib/db/queries/dashboard";
import { cn } from "@/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;

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
  const weekStart = new Date(weekStartIso);
  const today = new Date();

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getTime() + i * DAY_MS + 12 * 60 * 60 * 1000);
    const iso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
    }).format(d);
    return {
      iso,
      label: d.toLocaleDateString("en-US", { weekday: "narrow", timeZone: "America/New_York" }),
      done: habit.doneDates.includes(iso),
      future: d.getTime() > today.getTime() + 12 * 60 * 60 * 1000,
    };
  });

  const doneCount = habit.doneDates.length;
  const met = doneCount >= habit.target;

  return (
    <li className="flex items-center gap-3">
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
                await toggleOccurrence(habit.id, d.iso, !d.done);
                router.refresh();
              })
            }
            className={cn(
              "flex size-6 items-center justify-center rounded-full border text-[10px] font-medium transition-colors",
              d.done
                ? "border-transparent text-white"
                : d.future
                  ? "border-border text-ink-faint/50"
                  : "border-border-strong text-ink-muted hover:border-ok hover:text-ok",
            )}
            style={d.done ? { backgroundColor: habit.categoryColor ?? "var(--ok)" } : undefined}
          >
            {d.label}
          </button>
        ))}
      </div>
      <span
        className={cn(
          "w-12 shrink-0 text-right font-mono text-xs",
          met ? "text-ok" : "text-ink-muted",
        )}
      >
        {doneCount} of {habit.target}
      </span>
    </li>
  );
}
