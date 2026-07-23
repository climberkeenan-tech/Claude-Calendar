"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import type { CalendarItem } from "@/lib/db/queries/calendar";
import { deleteEvent, editEvent, toggleOccurrence } from "@/server/calendar";
import { completeEvent } from "@/server/events";
import { EventDetailsSection } from "./event-details";
import { cn } from "@/lib/utils";

export type SelectedItem = { item: CalendarItem };
type Category = { id: string; name: string; color: string };
type Scope = "single" | "series" | "future";

function p(n: number) {
  return String(n).padStart(2, "0");
}
function dateVal(d: Date | null): string {
  return d ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` : "";
}
function timeVal(d: Date | null): string {
  return d ? `${p(d.getHours())}:${p(d.getMinutes())}` : "";
}

export function EventDialog({
  selected,
  categories,
  courses,
  onClose,
}: {
  selected: SelectedItem | null;
  categories: Category[];
  courses: { id: string; name: string }[];
  onClose: () => void;
}) {
  const item = selected?.item ?? null;
  if (!item) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={
          item.kind === "task"
            ? "Edit task"
            : item.kind === "habit"
              ? "Edit habit"
              : "Edit event"
        }
        description={item.recurring ? "This is part of a repeating series." : undefined}
      >
        {/* key remounts the form whenever a different item/occurrence opens */}
        <EventForm
          key={`${item.id}|${item.occurrenceDate ?? ""}`}
          item={item}
          categories={categories}
          courses={courses}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

function EventForm({
  item,
  categories,
  courses,
  onClose,
}: {
  item: CalendarItem;
  categories: Category[];
  courses: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [showDetails, setShowDetails] = React.useState(false);
  const [detailsMounted, setDetailsMounted] = React.useState(false);
  const detailsFlushRef = React.useRef<(() => Promise<void>) | null>(null);
  const router = useRouter();
  const isTask = item.kind === "task";
  const anchor = item.startsAt ?? item.dueAt;

  const [scope, setScope] = React.useState<Scope>(item.recurring ? "single" : "series");
  const [title, setTitle] = React.useState(item.title);
  const [location, setLocation] = React.useState(item.location ?? "");
  const [categoryId, setCategoryId] = React.useState(item.categoryId ?? "");
  const [date, setDate] = React.useState(dateVal(anchor));
  const [time, setTime] = React.useState(item.allDay ? "" : timeVal(anchor));
  const [duration, setDuration] = React.useState(
    item.startsAt && item.endsAt
      ? Math.max(5, Math.round((item.endsAt.getTime() - item.startsAt.getTime()) / 60000))
      : 60,
  );
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  async function save() {
    if (pending) return;
    setPending(true);
    setError(null);
    let startsAt: Date | null = null;
    let endsAt: Date | null = null;
    let dueAt: Date | null = null;
    if (date) {
      const instant = new Date(`${date}T${time || "00:00"}:00`);
      if (isTask) {
        dueAt = time ? instant : new Date(`${date}T23:59:00`);
      } else {
        startsAt = instant;
        endsAt = new Date(instant.getTime() + duration * 60000);
      }
    }
    const result = await editEvent({
      eventId: item.id,
      occurrenceDate: item.occurrenceDate,
      occurrenceStart: item.startsAt,
      scope: item.recurring ? scope : "series",
      title,
      location: location || null,
      categoryId: categoryId || null,
      startsAt,
      endsAt,
      dueAt,
    });
    if (result.error) {
      setPending(false);
      setError(result.error);
      return;
    }
    // Unsaved "More details" edits ride along with the main Save — closing
    // the sheet must never silently discard typed notes.
    if (detailsFlushRef.current) {
      try {
        await detailsFlushRef.current();
      } catch {
        setPending(false);
        setError("Saved the basics, but details failed — they're still in the form.");
        setShowDetails(true);
        return;
      }
    }
    setPending(false);
    router.refresh();
    onClose();
  }

  async function toggleDone() {
    if (pending) return;
    setPending(true);
    if (item.recurring && item.occurrenceDate) {
      await toggleOccurrence(item.id, item.occurrenceDate, !item.completed);
    } else {
      await completeEvent(item.id, !item.completed);
    }
    setPending(false);
    router.refresh();
    onClose();
  }

  async function remove(delScope: Scope) {
    if (pending) return;
    setPending(true);
    await deleteEvent({
      eventId: item.id,
      occurrenceDate: item.occurrenceDate,
      occurrenceStart: item.startsAt,
      scope: delScope,
    });
    setPending(false);
    router.refresh();
    onClose();
  }

  return (
    <div className="flex flex-col gap-4">
      {item.recurring ? (
        <div className="flex gap-1.5" role="radiogroup" aria-label="Apply changes to">
          {(
            [
              ["single", "This one"],
              ["future", "This & future"],
              ["series", "Whole series"],
            ] as [Scope, string][]
          ).map(([s, label]) => (
            <button
              key={s}
              role="radio"
              aria-checked={scope === s}
              onClick={() => setScope(s)}
              className={cn(
                "flex-1 rounded-(--radius-sm) border px-2 py-1.5 text-xs font-medium transition-colors",
                scope === s
                  ? "border-accent bg-accent-soft text-ink"
                  : "border-border text-ink-muted hover:border-border-strong",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      <Field label="Title" htmlFor="ed-title">
        <Input id="ed-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="ed-date">
          <Input
            id="ed-date"
            type="date"
            value={date}
            disabled={item.recurring && scope === "series"}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label={isTask ? "Due time" : "Start time"} htmlFor="ed-time">
          <Input id="ed-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      {item.recurring && scope === "series" ? (
        <p className="-mt-2 text-xs text-ink-faint">
          The whole series keeps its days — change the time or duration here, or
          use “This one” / “This &amp; future” to move dates.
        </p>
      ) : null}

      {!isTask ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (min)" htmlFor="ed-dur">
            <Input
              id="ed-dur"
              type="number"
              min={5}
              max={1440}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value) || 60)}
            />
          </Field>
          <Field label="Location" htmlFor="ed-loc">
            <Input id="ed-loc" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} />
          </Field>
        </div>
      ) : null}

      <Field label="Category" htmlFor="ed-cat">
        <select
          id="ed-cat"
          value={categoryId}
          disabled={item.recurring && scope === "single"}
          onChange={(e) => setCategoryId(e.target.value)}
          className="h-10 rounded-(--radius-sm) border border-border bg-surface px-2 text-sm text-ink disabled:opacity-50"
        >
          <option value="">None</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      {item.recurring && scope === "single" ? (
        <p className="-mt-2 text-xs text-ink-faint">
          Category applies to the whole series — switch scope to change it.
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setShowDetails((v) => !v);
          setDetailsMounted(true);
        }}
        className="self-start text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
      >
        {showDetails ? "Hide details" : "More details — priority, checklist, reminders…"}
      </button>
      {/* Stays mounted once opened — hiding must never discard unsaved edits */}
      {detailsMounted ? (
        <div hidden={!showDetails}>
          <EventDetailsSection
            eventId={item.id}
            courses={courses}
            flushRef={detailsFlushRef}
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {!confirmDelete ? (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={pending}>
              Delete…
            </Button>
          ) : item.recurring ? (
            <div className="flex items-center gap-1">
              <Button variant="danger" size="sm" onClick={() => remove("single")} disabled={pending}>
                This one
              </Button>
              <Button variant="danger" size="sm" onClick={() => remove("future")} disabled={pending}>
                & future
              </Button>
              <Button variant="danger" size="sm" onClick={() => remove("series")} disabled={pending}>
                Series
              </Button>
            </div>
          ) : (
            <Button variant="danger" size="sm" onClick={() => remove("series")} disabled={pending}>
              Confirm delete
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={toggleDone} disabled={pending}>
            {item.completed ? "Un-complete" : "Complete ✓"}
          </Button>
          <Button onClick={save} disabled={pending || !title.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
