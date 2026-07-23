"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import {
  addChecklistItem,
  deleteChecklistItem,
  getEventDetails,
  setEventReminders,
  toggleChecklistItem,
  updateEventDetails,
  type EventDetails,
} from "@/server/details";
import { STANDARD_OFFSETS, offsetLabel } from "@/lib/reminders";
import { cn } from "@/lib/utils";

type Course = { id: string; name: string };

const PRIORITIES = [
  { key: "low", label: "Low" },
  { key: "normal", label: "Normal" },
  { key: "high", label: "High" },
  { key: "critical", label: "Critical" },
] as const;

/**
 * The "More details" half of the event sheet: description, notes, priority,
 * estimates, tags, course, checklist, reminders. Lazy-loaded on expand so the
 * common quick-edit path stays light.
 */
export function EventDetailsSection({
  eventId,
  courses,
}: {
  eventId: string;
  courses: Course[];
}) {
  const router = useRouter();
  const [details, setDetails] = React.useState<EventDetails | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [newItem, setNewItem] = React.useState("");
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    getEventDetails(eventId)
      .then((d) => {
        if (alive) setDetails(d);
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, [eventId]);

  if (loadError) {
    return <p className="text-sm text-danger">Couldn&apos;t load details.</p>;
  }
  if (!details) {
    return <p className="py-4 text-center text-sm text-ink-faint">Loading details…</p>;
  }

  const patch = (p: Partial<EventDetails>) => {
    setDetails((d) => (d ? { ...d, ...p } : d));
    setDirty(true);
  };

  function saveDetails() {
    if (!details) return;
    startTransition(async () => {
      await updateEventDetails({
        eventId,
        description: details.description,
        notes: details.notes,
        priority: details.priority,
        estimatedMinutes: details.estimatedMinutes,
        actualMinutes: details.actualMinutes,
        tags: details.tags,
        courseId: details.courseId,
      });
      setDirty(false);
      router.refresh();
    });
  }

  function toggleOffset(minutes: number) {
    if (!details) return;
    const has = details.reminderOffsets.includes(minutes);
    const next = has
      ? details.reminderOffsets.filter((m) => m !== minutes)
      : [...details.reminderOffsets, minutes];
    setDetails((d) => (d ? { ...d, reminderOffsets: next } : d));
    startTransition(async () => {
      await setEventReminders({ eventId, offsets: next });
    });
  }

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority" htmlFor="det-priority">
          <select
            id="det-priority"
            value={details.priority}
            onChange={(e) => patch({ priority: e.target.value as EventDetails["priority"] })}
            className="h-10 rounded-(--radius-sm) border border-border bg-surface px-2 text-sm text-ink"
          >
            {PRIORITIES.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Course" htmlFor="det-course">
          <select
            id="det-course"
            value={details.courseId ?? ""}
            onChange={(e) => patch({ courseId: e.target.value || null })}
            className="h-10 rounded-(--radius-sm) border border-border bg-surface px-2 text-sm text-ink"
          >
            <option value="">None</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Estimated (min)" htmlFor="det-est">
          <Input
            id="det-est"
            type="number"
            min={1}
            max={6000}
            value={details.estimatedMinutes ?? ""}
            onChange={(e) =>
              patch({ estimatedMinutes: e.target.value ? Number(e.target.value) : null })
            }
          />
        </Field>
        <Field label="Actual (min)" htmlFor="det-act">
          <Input
            id="det-act"
            type="number"
            min={1}
            max={6000}
            value={details.actualMinutes ?? ""}
            onChange={(e) =>
              patch({ actualMinutes: e.target.value ? Number(e.target.value) : null })
            }
          />
        </Field>
      </div>

      <Field label="Description" htmlFor="det-desc">
        <textarea
          id="det-desc"
          value={details.description ?? ""}
          onChange={(e) => patch({ description: e.target.value || null })}
          rows={2}
          className="rounded-(--radius-sm) border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          placeholder="What is this?"
        />
      </Field>

      <Field label="Notes" htmlFor="det-notes">
        <textarea
          id="det-notes"
          value={details.notes ?? ""}
          onChange={(e) => patch({ notes: e.target.value || null })}
          rows={2}
          className="rounded-(--radius-sm) border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          placeholder="Anything to remember"
        />
      </Field>

      <Field label="Tags (comma-separated)" htmlFor="det-tags">
        <Input
          id="det-tags"
          value={details.tags.join(", ")}
          onChange={(e) =>
            patch({
              tags: e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
                .slice(0, 20),
            })
          }
          placeholder="reading, group-project"
        />
      </Field>

      {dirty ? (
        <Button size="sm" onClick={saveDetails} disabled={pending} className="self-end">
          {pending ? "Saving…" : "Save details"}
        </Button>
      ) : null}

      {/* Checklist */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-muted">Checklist</span>
        {details.checklist.map((item) => (
          <div key={item.id} className="group flex items-center gap-2">
            <button
              aria-pressed={item.done}
              aria-label={`Toggle “${item.text}”`}
              onClick={() => {
                setDetails((d) =>
                  d
                    ? {
                        ...d,
                        checklist: d.checklist.map((c) =>
                          c.id === item.id ? { ...c, done: !c.done } : c,
                        ),
                      }
                    : d,
                );
                startTransition(() => toggleChecklistItem(item.id, !item.done));
              }}
              className={cn(
                "flex size-4.5 items-center justify-center rounded border text-[9px]",
                item.done
                  ? "border-ok bg-ok text-white"
                  : "border-border-strong text-transparent hover:border-ok",
              )}
            >
              ✓
            </button>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                item.done ? "text-ink-faint line-through" : "text-ink",
              )}
            >
              {item.text}
            </span>
            <button
              aria-label={`Remove “${item.text}”`}
              onClick={() => {
                setDetails((d) =>
                  d ? { ...d, checklist: d.checklist.filter((c) => c.id !== item.id) } : d,
                );
                startTransition(() => deleteChecklistItem(item.id));
              }}
              className="text-ink-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        ))}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = newItem.trim();
            if (!text) return;
            setNewItem("");
            startTransition(async () => {
              const id = await addChecklistItem(eventId, text);
              setDetails((d) =>
                d ? { ...d, checklist: [...d.checklist, { id, text, done: false }] } : d,
              );
            });
          }}
        >
          <Input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            placeholder="Add a step…"
            aria-label="New checklist item"
            className="h-8 text-sm"
            maxLength={300}
          />
        </form>
      </div>

      {/* Reminders */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-muted">
          Reminders{" "}
          <span className="font-normal text-ink-faint">(delivery goes live in Phase 5)</span>
        </span>
        <div className="flex flex-wrap gap-1.5">
          {STANDARD_OFFSETS.map((o) => {
            const on = details.reminderOffsets.includes(o.minutes);
            return (
              <button
                key={o.minutes}
                aria-pressed={on}
                onClick={() => toggleOffset(o.minutes)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  on
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-border text-ink-muted hover:border-border-strong",
                )}
              >
                {offsetLabel(o.minutes).replace(" before", "")}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
