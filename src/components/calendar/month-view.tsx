"use client";

import type { CalendarItem } from "@/lib/db/queries/calendar";
import { contrastText } from "@/lib/utils";
import { dayOfMonth, isoDay, shiftDay, weekdayIndex } from "@/lib/time";
import type { SelectedItem } from "./event-dialog";

export function MonthView({
  anchorIso,
  items,
  onDay,
  onSelect,
}: {
  anchorIso: string;
  items: CalendarItem[];
  onDay: (iso: string) => void;
  onSelect: (s: SelectedItem) => void;
}) {
  // Grid math on ISO strings in the PROFILE timezone — a browser in another
  // zone must still see the same month laid out the same way.
  const monthStr = anchorIso.slice(0, 7);
  const firstIso = `${monthStr}-01`;
  const lead = weekdayIndex(firstIso); // Monday-first
  const gridStartIso = shiftDay(firstIso, -lead);
  const todayIso = isoDay(new Date());

  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const anchor = item.startsAt ?? item.dueAt;
    if (!anchor) continue;
    const iso = isoDay(anchor);
    byDay.set(iso, [...(byDay.get(iso) ?? []), item]);
  }

  const cells = Array.from({ length: 42 }, (_, i) => {
    const iso = shiftDay(gridStartIso, i);
    return { iso, inMonth: iso.slice(0, 7) === monthStr };
  });

  return (
    <div className="overflow-hidden rounded-(--radius) border border-border bg-surface shadow-soft">
      <div className="grid grid-cols-7 border-b border-border">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-ink-faint">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const dayItems = byDay.get(cell.iso) ?? [];
          const shown = dayItems.slice(0, 3);
          const extra = dayItems.length - shown.length;
          return (
            <div
              key={cell.iso}
              className={`min-h-24 border-b border-l border-border/60 p-1 ${cell.inMonth ? "" : "bg-bg/60"}`}
            >
              <button
                onClick={() => onDay(cell.iso)}
                className={
                  cell.iso === todayIso
                    ? "mb-1 flex size-6 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-text"
                    : `mb-1 flex size-6 items-center justify-center rounded-full text-xs ${cell.inMonth ? "text-ink" : "text-ink-faint"} hover:bg-accent-soft`
                }
                aria-label={`Open ${cell.iso}`}
              >
                {dayOfMonth(cell.iso)}
              </button>
              <div className="flex flex-col gap-0.5">
                {shown.map((item) => {
                  const bg = item.categoryColor ?? "#9b998f";
                  const isTask = item.kind === "task";
                  return (
                    <button
                      key={`${item.id}-${item.occurrenceDate ?? ""}`}
                      onClick={() => onSelect({ item })}
                      className="truncate rounded px-1 py-px text-left text-[10px] font-medium leading-tight"
                      style={{
                        backgroundColor: isTask ? "transparent" : bg,
                        color: isTask ? "var(--text)" : contrastText(bg),
                        borderLeft: isTask ? `3px solid ${bg}` : undefined,
                        opacity: item.completed ? 0.45 : 1,
                      }}
                    >
                      {item.title}
                    </button>
                  );
                })}
                {extra > 0 ? (
                  <button
                    onClick={() => onDay(cell.iso)}
                    className="px-1 text-left text-[10px] text-ink-faint hover:text-ink"
                  >
                    +{extra} more
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
