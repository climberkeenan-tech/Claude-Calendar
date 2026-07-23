"use client";

import type { CalendarItem } from "@/lib/db/queries/calendar";
import { CategoryDot } from "@/components/ui/badge";
import { Card, CardBody, EmptyState } from "@/components/ui/card";
import type { SelectedItem } from "./event-dialog";

function isoOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function AgendaView({
  anchorIso,
  items,
  onSelect,
}: {
  anchorIso: string;
  items: CalendarItem[];
  onSelect: (s: SelectedItem) => void;
}) {
  const groups = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const anchor = item.startsAt ?? item.dueAt;
    if (!anchor) continue;
    const iso = isoOf(anchor);
    if (iso < anchorIso) continue;
    groups.set(iso, [...(groups.get(iso) ?? []), item]);
  }
  const days = [...groups.keys()].sort();

  if (days.length === 0) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            headline="Nothing in the next 30 days"
            hint="Press Q to add events, tasks, or habits."
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {days.map((iso) => {
        const d = new Date(`${iso}T12:00:00`);
        return (
          <div key={iso}>
            <h2 className="mb-1.5 px-1 font-display text-lg text-ink">
              {d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </h2>
            <Card>
              <CardBody className="py-2">
                <ul className="flex flex-col divide-y divide-border/70">
                  {groups.get(iso)!.map((item) => (
                    <li key={`${item.id}-${item.occurrenceDate ?? ""}`}>
                      <button
                        onClick={() => onSelect({ item })}
                        className="flex w-full items-center gap-3 py-2 text-left hover:bg-accent-soft/40"
                      >
                        <span className="w-20 shrink-0 font-mono text-xs text-ink-muted">
                          {item.allDay
                            ? "all day"
                            : (item.startsAt ?? item.dueAt)?.toLocaleTimeString("en-US", {
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                        </span>
                        {item.categoryColor ? (
                          <CategoryDot color={item.categoryColor} />
                        ) : (
                          <span className="size-2.5" />
                        )}
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${item.completed ? "text-ink-faint line-through" : "text-ink"}`}
                        >
                          {item.kind === "task" ? "◻ " : ""}
                          {item.recurring ? "↻ " : ""}
                          {item.title}
                        </span>
                        {item.courseName ? (
                          <span className="hidden shrink-0 text-xs text-ink-faint sm:block">
                            {item.courseName}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </div>
        );
      })}
    </div>
  );
}
