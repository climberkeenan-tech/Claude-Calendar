"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { CalendarItem } from "@/lib/db/queries/calendar";
import { layoutDay } from "@/lib/calendar/layout";
import { contrastText } from "@/lib/utils";
import {
  dayOfMonth,
  fmtHourLabel,
  fmtIsoDay,
  instantFromWallClock,
  isoDay,
  minutesOfDay,
  shiftDay,
} from "@/lib/time";
import { ActionError, useActionGuard } from "@/components/ui/action-error";
import { moveEvent } from "@/server/calendar";
import type { SelectedItem } from "./event-dialog";

const HOUR_PX = 48;
const SNAP_MIN = 15;

/** Day key and wall-clock minutes in the PROFILE timezone — never the
 * browser's, or the grid silently re-buckets every event when you travel. */
const isoOf = (d: Date): string => isoDay(d);
const minOf = (d: Date): number => minutesOfDay(d);

type DragState = {
  item: CalendarItem;
  mode: "move" | "resize";
  dayIdx: number;
  startMin: number;
  endMin: number;
  pointerStartY: number;
  pointerStartX: number;
  origStartMin: number;
  origEndMin: number;
  origDayIdx: number;
  moved: boolean;
};

export function TimeGrid({
  days,
  firstDayIso,
  todayIso,
  items,
  onSelect,
}: {
  days: 1 | 7;
  firstDayIso: string;
  todayIso: string;
  items: CalendarItem[];
  onSelect: (s: SelectedItem) => void;
}) {
  const router = useRouter();
  const gridRef = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const guard = useActionGuard();
  const [nowTick, setNowTick] = React.useState(() => new Date());

  React.useEffect(() => {
    const t = setInterval(() => setNowTick(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Scroll to ~8 AM on mount
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 7.5 * HOUR_PX });
  }, []);

  const dayIsos = React.useMemo(
    () => Array.from({ length: days }, (_, i) => shiftDay(firstDayIso, i)),
    [firstDayIso, days],
  );

  // Bucket timed items by local day; all-day items separately.
  const { timedByDay, allDayByDay } = React.useMemo(() => {
    const timed = new Map<string, CalendarItem[]>();
    const allday = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const anchor = item.startsAt ?? item.dueAt;
      if (!anchor) continue;
      const iso = isoOf(anchor);
      if (!dayIsos.includes(iso)) continue;
      if (item.allDay) {
        allday.set(iso, [...(allday.get(iso) ?? []), item]);
      } else {
        timed.set(iso, [...(timed.get(iso) ?? []), item]);
      }
    }
    return { timedByDay: timed, allDayByDay: allday };
  }, [items, dayIsos]);

  function minutesFromPointer(e: React.PointerEvent): { min: number; dayIdx: number } {
    const rect = gridRef.current!.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const x = e.clientX - rect.left;
    const min = Math.max(0, Math.min(24 * 60, Math.round((y / HOUR_PX) * 60)));
    const dayIdx = Math.max(0, Math.min(days - 1, Math.floor((x / rect.width) * days)));
    return { min, dayIdx };
  }

  function snap(min: number): number {
    return Math.round(min / SNAP_MIN) * SNAP_MIN;
  }

  function beginDrag(e: React.PointerEvent, item: CalendarItem, mode: "move" | "resize") {
    if (!item.startsAt && !item.dueAt) return;
    e.preventDefault();
    e.stopPropagation();
    // Capture on the grid, not the event box — the box unmounts on the next
    // render (it's filtered out for the ghost), which would release capture
    // and leave a sticky drag that commits on the next stray click.
    gridRef.current?.setPointerCapture(e.pointerId);
    const anchor = item.startsAt ?? item.dueAt!;
    const end = item.endsAt ?? new Date(anchor.getTime() + 30 * 60000);
    // True duration in minutes — never minute-of-day arithmetic, which
    // corrupts events that end at or after midnight.
    const durMin = Math.max(SNAP_MIN, Math.round((end.getTime() - anchor.getTime()) / 60000));
    const startMin = minOf(anchor);
    const dayIdx = dayIsos.indexOf(isoOf(anchor));
    setDrag({
      item,
      mode,
      dayIdx,
      startMin,
      endMin: startMin + durMin,
      pointerStartY: e.clientY,
      pointerStartX: e.clientX,
      origStartMin: startMin,
      origEndMin: startMin + durMin,
      origDayIdx: dayIdx,
      moved: false,
    });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const { min, dayIdx } = minutesFromPointer(e);
    const deltaY = Math.abs(e.clientY - drag.pointerStartY);
    const deltaX = Math.abs(e.clientX - drag.pointerStartX);
    const moved = drag.moved || deltaY > 4 || deltaX > 4;
    if (drag.mode === "move") {
      const dur = drag.origEndMin - drag.origStartMin;
      const pointerOffset = drag.origStartMin - snapPointerStart(drag);
      let start = snap(min + pointerOffset);
      // Keep the start inside the day; a long event may legitimately end
      // past midnight (duration is preserved at commit).
      start = Math.max(0, Math.min(24 * 60 - Math.min(dur, 24 * 60), start));
      setDrag({ ...drag, startMin: start, endMin: start + dur, dayIdx, moved });
    } else {
      const end = Math.max(drag.origStartMin + SNAP_MIN, snap(min));
      setDrag({ ...drag, endMin: Math.min(24 * 60, end), moved });
    }
  }

  function snapPointerStart(d: DragState): number {
    const rect = gridRef.current!.getBoundingClientRect();
    const y = d.pointerStartY - rect.top;
    return Math.round((y / HOUR_PX) * 60);
  }

  async function onPointerUp() {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (!d.moved) {
      // Click, not drag → open the editor.
      onSelect({ item: d.item });
      return;
    }
    const iso = dayIsos[d.dayIdx];
    // Build the instant from WALL-CLOCK fields, not midnight + elapsed ms:
    // on DST days the two diverge, and the grid renders wall clock — so an
    // event dropped on the 10 AM row committed 9 AM and visibly jumped.
    const pad = (n: number) => String(n).padStart(2, "0");
    const startsAt = instantFromWallClock(
      iso,
      `${pad(Math.floor(d.startMin / 60))}:${pad(d.startMin % 60)}`,
    );
    const endsAt = new Date(startsAt.getTime() + (d.endMin - d.startMin) * 60000);
    const ok = await guard.run(
      () =>
        moveEvent({
          eventId: d.item.id,
          occurrenceDate: d.item.occurrenceDate,
          startsAt,
          endsAt,
        }),
      `Couldn't move “${d.item.title}” — it snapped back. Check your connection.`,
    );
    if (ok) router.refresh();
  }

  const nowIso = isoOf(nowTick);
  const nowMin = minOf(nowTick);

  return (
    <div className="overflow-hidden rounded-(--radius) border border-border bg-surface shadow-soft">
      <ActionError
        message={guard.error}
        className="border-b border-danger/40 bg-danger-soft px-3 py-2 text-xs text-ink"
      />
      {/* Day headers + all-day row */}
      <div className="grid border-b border-border" style={{ gridTemplateColumns: `3.5rem repeat(${days}, 1fr)` }}>
        <div />
        {dayIsos.map((iso) => {
          const isToday = iso === todayIso;
          return (
            <div key={iso} className="border-l border-border px-2 py-2 text-center">
              <p className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                {fmtIsoDay(iso, { weekday: "short" })}
              </p>
              <p
                className={
                  isToday
                    ? "mx-auto flex size-7 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-text"
                    : "text-sm text-ink"
                }
              >
                {dayOfMonth(iso)}
              </p>
              <div className="mt-1 flex flex-col gap-0.5">
                {(allDayByDay.get(iso) ?? []).map((item) => (
                  <button
                    key={`${item.id}-${item.occurrenceDate ?? ""}`}
                    onClick={() => onSelect({ item })}
                    className="truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium"
                    style={{
                      backgroundColor: item.categoryColor ?? "var(--accent-soft)",
                      color: item.categoryColor ? contrastText(item.categoryColor) : "var(--text)",
                    }}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="max-h-[70dvh] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: `3.5rem 1fr` }}>
          {/* Hour gutter */}
          <div className="relative" style={{ height: 24 * HOUR_PX }}>
            {Array.from({ length: 24 }, (_, h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-ink-faint"
                style={{ top: h * HOUR_PX }}
              >
                {h === 0 ? "" : fmtHourLabel(h)}
              </span>
            ))}
          </div>

          {/* Days */}
          <div
            ref={gridRef}
            className="relative touch-none select-none"
            style={{ height: 24 * HOUR_PX }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
          >
            {/* Hour lines */}
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute inset-x-0 border-t border-border/60"
                style={{ top: h * HOUR_PX }}
              />
            ))}
            {/* Day columns */}
            <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days}, 1fr)` }}>
              {dayIsos.map((iso, dayIdx) => {
                const dayItems = (timedByDay.get(iso) ?? []).filter(
                  (i) => !(drag && drag.item === i),
                );
                const boxes = layoutDay(
                  dayItems.map((i) => {
                    const s = i.startsAt ?? i.dueAt!;
                    const e = i.endsAt ?? new Date(s.getTime() + 30 * 60000);
                    return {
                      id: `${i.id}|${i.occurrenceDate ?? ""}`,
                      startMin: minOf(s),
                      endMin: Math.max(minOf(s) + 20, minOf(e) || 24 * 60),
                    };
                  }),
                );
                const boxById = new Map(boxes.map((b) => [b.id, b]));
                return (
                  <div key={iso} className="relative border-l border-border/60">
                    {iso === nowIso ? (
                      <div
                        className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-accent"
                        style={{ top: (nowMin / 60) * HOUR_PX }}
                      >
                        <span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-accent" />
                      </div>
                    ) : null}
                    {dayItems.map((item) => {
                      const key = `${item.id}|${item.occurrenceDate ?? ""}`;
                      const box = boxById.get(key);
                      if (!box) return null;
                      const isTask = item.kind === "task";
                      const bg = item.categoryColor ?? "#9b998f";
                      return (
                        <div
                          key={key}
                          role="button"
                          tabIndex={0}
                          onPointerDown={(e) => beginDrag(e, item, "move")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") onSelect({ item });
                          }}
                          className="absolute overflow-hidden rounded-lg border border-black/10 px-1.5 py-0.5 text-[11px] leading-tight shadow-soft transition-[filter] hover:brightness-105"
                          style={{
                            top: (box.startMin / 60) * HOUR_PX,
                            height: Math.max(18, ((box.endMin - box.startMin) / 60) * HOUR_PX - 2),
                            left: `calc(${(box.col / box.cols) * 100}% + 2px)`,
                            width: `calc(${(1 / box.cols) * 100}% - 4px)`,
                            backgroundColor: isTask ? "transparent" : bg,
                            color: isTask ? "var(--text)" : contrastText(bg),
                            borderLeft: isTask ? `3px solid ${bg}` : undefined,
                            backdropFilter: isTask ? "brightness(0.97)" : undefined,
                            opacity: item.completed ? 0.75 : 1,
                            cursor: "grab",
                          }}
                        >
                          <span className={item.completed ? "line-through" : ""}>
                            {isTask ? "◻ " : ""}
                            {item.recurring ? "↻ " : ""}
                            {item.title}
                          </span>
                          {/* Resize handle (events only) */}
                          {!isTask && item.endsAt ? (
                            <div
                              onPointerDown={(e) => beginDrag(e, item, "resize")}
                              className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                            />
                          ) : null}
                        </div>
                      );
                    })}
                    {/* Drag ghost */}
                    {drag && drag.dayIdx === dayIdx ? (
                      <div
                        className="pointer-events-none absolute inset-x-0.5 z-20 rounded-lg border-2 border-accent bg-accent-soft/70 px-1.5 text-[11px] font-medium text-ink"
                        style={{
                          top: (drag.startMin / 60) * HOUR_PX,
                          height: Math.max(18, ((drag.endMin - drag.startMin) / 60) * HOUR_PX),
                        }}
                      >
                        {drag.item.title}
                        <span className="ml-1 font-mono text-[10px]">
                          {String(Math.floor(drag.startMin / 60)).padStart(2, "0")}:
                          {String(drag.startMin % 60).padStart(2, "0")}
                        </span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
