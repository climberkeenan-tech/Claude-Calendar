"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { shortcutsSuspended } from "@/components/shortcuts/shortcuts-overlay";
import type { CalendarItem } from "@/lib/db/queries/calendar";
import { cn } from "@/lib/utils";
import { fmtIsoDay, isoDay, shiftDay, weekdayIndex } from "@/lib/time";
import { TimeGrid } from "./time-grid";
import { MonthView } from "./month-view";
import { AgendaView } from "./agenda-view";
import { EventDialog, type SelectedItem } from "./event-dialog";

export type CalendarView = "day" | "week" | "month" | "agenda";
type Category = { id: string; name: string; color: string };

const VIEWS: { key: CalendarView; label: string; shortcut: string }[] = [
  { key: "day", label: "Day", shortcut: "1" },
  { key: "week", label: "Week", shortcut: "2" },
  { key: "month", label: "Month", shortcut: "3" },
  { key: "agenda", label: "Agenda", shortcut: "4" },
];

const shiftIso = shiftDay;

/** Month navigation moves by CALENDAR month (anchored to the 1st) — stepping
 * 30 days from Jan 31 would skip February entirely. */
function shiftMonth(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 10);
}

/** Monday-start week begin for an ISO day. */
export function weekStartIso(iso: string): string {
  return shiftDay(iso, -weekdayIndex(iso));
}

export function CalendarShell({
  view,
  anchorIso,
  items,
  categories,
  courses,
}: {
  view: CalendarView;
  anchorIso: string;
  items: CalendarItem[];
  categories: Category[];
  courses: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<SelectedItem | null>(null);

  const go = React.useCallback(
    (nextView: CalendarView, nextIso: string) => {
      router.push(`/calendar?view=${nextView}&date=${nextIso}`);
    },
    [router],
  );

  const step = view === "day" ? 1 : view === "week" ? 7 : 30;
  const nav = React.useCallback(
    (dir: -1 | 1) =>
      view === "month"
        ? shiftMonth(anchorIso, dir)
        : shiftIso(anchorIso, dir * step),
    [view, anchorIso, step],
  );
  // "Today" is the profile timezone's today — not the browser's, which would
  // highlight the wrong column from another timezone.
  const todayIso = isoDay(new Date());

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (shortcutsSuspended(e)) return;
      const v = VIEWS.find((x) => x.shortcut === e.key);
      if (v) {
        e.preventDefault();
        go(v.key, anchorIso);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(view, nav(-1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(view, nav(1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, anchorIso, go, nav]);

  const heading =
    view === "week"
      ? `Week of ${fmtIsoDay(weekStartIso(anchorIso), { month: "long", day: "numeric" })}`
      : view === "month"
        ? fmtIsoDay(anchorIso, { month: "long", year: "numeric" })
        : view === "day"
          ? fmtIsoDay(anchorIso, { weekday: "long", month: "long", day: "numeric" })
          : "Next 30 days";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl text-ink">{heading}</h1>
        {/* Wraps too. The row above wrapped but this group didn't, so on a
            390 px screen the four view buttons plus ← Today → came to 415 px
            and pushed the whole PAGE sideways — the one thing a phone layout
            must never do. Now the nav buttons drop to their own line. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-(--radius-sm) border border-border">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => go(v.key, anchorIso)}
                aria-pressed={view === v.key}
                title={`${v.label} (${v.shortcut})`}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium transition-colors",
                  view === v.key
                    ? "bg-accent-soft text-ink"
                    : "bg-surface text-ink-muted hover:text-ink",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" aria-label="Previous" onClick={() => go(view, nav(-1))}>
              ←
            </Button>
            <Button variant="secondary" size="sm" onClick={() => go(view, todayIso)}>
              Today
            </Button>
            <Button variant="secondary" size="sm" aria-label="Next" onClick={() => go(view, nav(1))}>
              →
            </Button>
          </div>
        </div>
      </div>

      {view === "month" ? (
        <MonthView anchorIso={anchorIso} items={items} onDay={(iso) => go("day", iso)} onSelect={setSelected} />
      ) : view === "agenda" ? (
        <AgendaView anchorIso={anchorIso} items={items} onSelect={setSelected} />
      ) : (
        <TimeGrid
          days={view === "day" ? 1 : 7}
          firstDayIso={view === "day" ? anchorIso : weekStartIso(anchorIso)}
          todayIso={todayIso}
          items={items}
          onSelect={setSelected}
        />
      )}

      <EventDialog
        selected={selected}
        categories={categories}
        courses={courses}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
