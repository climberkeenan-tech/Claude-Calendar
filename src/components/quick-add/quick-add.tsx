"use client";

import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { shortcutsSuspended } from "@/components/shortcuts/shortcuts-overlay";
import { CategoryDot } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { parseLocal, type ClaudeDraft, type ParsedDraft } from "@/lib/ai/quick-add";
import {
  fmtShortDay,
  fmtTime,
  instantFromWallClock,
  instantFromWallClockIso,
  isoDay,
  timeValue,
  wallClockValue,
} from "@/lib/time";
import { createFromDraft } from "@/server/quick-add";

type Category = { id: string; name: string; color: string };

/** Instant → profile wall-clock ISO (no timezone suffix) — the shape the
 * server's draft schema expects. */
function toLocalIso(d: Date): string {
  return wallClockValue(d);
}

function chipDate(d: Date): string {
  return fmtShortDay(d);
}
function chipTime(d: Date): string {
  return fmtTime(d);
}

const KIND_LABEL = { event: "Event", task: "Task", habit: "Habit" } as const;

function mergeClaude(
  text: string,
  prev: ParsedDraft | null,
  c: ClaudeDraft,
): ParsedDraft {
  // Claude returns a zone-less wall clock — it means campus time, not whatever
  // zone this laptop happens to be sitting in.
  const start = c.start ? instantFromWallClockIso(c.start) : null;
  const due = c.due ? instantFromWallClockIso(c.due) : null;
  return {
    title: c.title || prev?.title || text.trim(),
    kind: c.kind,
    startIso: c.kind === "task" ? null : (start?.toISOString() ?? prev?.startIso ?? null),
    endIso:
      c.kind !== "task" && start && c.durationMinutes
        ? new Date(start.getTime() + c.durationMinutes * 60000).toISOString()
        : (prev?.endIso ?? null),
    dueIso: c.kind === "task" ? (due?.toISOString() ?? prev?.dueIso ?? null) : null,
    allDay: c.allDay,
    rrule: c.rrule ?? prev?.rrule ?? null,
    rruleLabel: c.rruleLabel ?? prev?.rruleLabel ?? null,
    categoryName: c.categoryName ?? prev?.categoryName ?? null,
    habitTargetPerWeek: c.habitTargetPerWeek ?? prev?.habitTargetPerWeek ?? null,
    source: "claude",
  };
}

export function QuickAdd({ categories }: { categories: Category[] }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [draft, setDraft] = React.useState<ParsedDraft | null>(null);
  const [refining, setRefining] = React.useState(false);
  const [refined, setRefined] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [showDetails, setShowDetails] = React.useState(false);
  const reqRef = React.useRef(0);

  // Global shortcut
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (shortcutsSuspended(e)) return;
      if (e.key.toLowerCase() === "q") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Local parse happens in the change handler — chips are instant, no effect.
  function onTextChange(next: string) {
    // Invalidate any in-flight Claude request unconditionally — even when the
    // new text is too short to trigger a new one, a stale response must not
    // resurrect chips for text that no longer exists.
    reqRef.current++;
    setText(next);
    setRefined(false);
    setDraft(next.trim() ? parseLocal(next) : null);
  }

  // Claude refinement, debounced. Stale responses are discarded.
  React.useEffect(() => {
    if (!text.trim() || text.trim().length < 4) return;
    const id = ++reqRef.current;
    const t = setTimeout(async () => {
      setRefining(true);
      try {
        const res = await fetch("/api/quick-add/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (id !== reqRef.current) return; // user kept typing
        if (res.ok) {
          const c = (await res.json()) as ClaudeDraft;
          setDraft((prev) => mergeClaude(text, prev, c));
          setRefined(true);
        }
      } catch {
        /* local parse stands */
      } finally {
        if (id === reqRef.current) setRefining(false);
      }
    }, 700);
    return () => clearTimeout(t);
  }, [text]);

  async function confirm() {
    if (!draft || pending) return;
    setPending(true);
    setError(null);
    const start = draft.startIso ? new Date(draft.startIso) : null;
    const end = draft.endIso ? new Date(draft.endIso) : null;
    const due = draft.dueIso ? new Date(draft.dueIso) : null;
    // A throw here (dropped wifi, expired session) must never strand
    // `pending` — the guard above would then block every retry and the one
    // capture path in the app would stay dead until a reload.
    let result: Awaited<ReturnType<typeof createFromDraft>>;
    try {
      result = await createFromDraft({
        title: draft.title,
        kind: draft.kind,
        startLocal: start ? toLocalIso(start) : null,
        durationMinutes:
          start && end ? Math.max(5, Math.round((end.getTime() - start.getTime()) / 60000)) : null,
        dueLocal: due ? toLocalIso(due) : null,
        allDay: draft.allDay,
        rrule: draft.rrule,
        categoryName: draft.categoryName,
        habitTargetPerWeek: draft.habitTargetPerWeek,
      });
    } catch {
      setPending(false);
      setError("Couldn't save that — check your connection and try again.");
      return;
    }
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setToast(result.inbox ? "Captured to Inbox — schedule it any time." : "Added.");
    setTimeout(() => setToast(null), 2500);
    resetParse();
    setOpen(false);
  }

  /** Clear all parse state AND invalidate any in-flight Claude refinement —
   * a late response must never resurrect a ghost draft after confirm/close. */
  function resetParse() {
    reqRef.current++;
    setText("");
    setDraft(null);
    setShowDetails(false);
    setRefining(false);
    setRefined(false);
    setError(null);
  }

  const anchor = draft?.startIso ?? draft?.dueIso;
  const anchorDate = anchor ? new Date(anchor) : null;

  return (
    <>
      <Button
        size="lg"
        className="fixed bottom-20 right-4 z-40 rounded-full shadow-raised md:bottom-8 md:right-8"
        onClick={() => setOpen(true)}
        aria-label="Quick add (Q)"
      >
        ＋ Quick add
      </Button>

      {toast ? (
        <div
          role="status"
          className="fixed bottom-36 right-4 z-50 rounded-(--radius-sm) border border-border bg-surface px-4 py-2 text-sm text-ink shadow-raised md:bottom-24 md:right-8"
        >
          {toast}
        </div>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) resetParse();
        }}
      >
        <DialogContent
          title="Quick add"
          description="Type it like you'd say it — “Study Biology tomorrow at 7 PM”, “Gym every Monday at 5”, “Essay due Friday”."
        >
          <div className="flex flex-col gap-3">
            <Input
              autoFocus
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirm();
                }
              }}
              placeholder="What's happening?"
              aria-label="Quick add input"
              className="h-12 text-base"
              maxLength={500}
            />

            {/* Instant chips from the local parse; ✦ marks Claude refinement */}
            {draft ? (
              <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
                <Chip label={KIND_LABEL[draft.kind]} tone="kind" />
                {anchorDate ? (
                  <Chip label={chipDate(anchorDate)} />
                ) : (
                  <Chip label="no date → Inbox" tone="muted" />
                )}
                {anchorDate && !draft.allDay ? <Chip label={chipTime(anchorDate)} /> : null}
                {draft.allDay && anchorDate ? <Chip label="all day" tone="muted" /> : null}
                {draft.rruleLabel ? <Chip label={`↻ ${draft.rruleLabel}`} /> : null}
                {draft.categoryName ? (
                  <Chip
                    label={draft.categoryName}
                    dotColor={categories.find((c) => c.name === draft.categoryName)?.color}
                  />
                ) : null}
                <span className="ml-1 text-xs text-ink-faint">
                  {refining ? "✦ refining…" : refined ? "✦ refined" : ""}
                </span>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="self-start text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              {showDetails ? "Hide details" : "Adjust details"}
            </button>

            {showDetails && draft ? (
              <DetailsEditor draft={draft} setDraft={setDraft} categories={categories} />
            ) : null}

            {error ? (
              <p role="alert" className="text-sm text-danger-ink">
                {error}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={confirm} disabled={!draft || pending}>
                {pending ? "Adding…" : "Add  ⏎"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Chip({
  label,
  tone,
  dotColor,
}: {
  label: string;
  tone?: "kind" | "muted";
  dotColor?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        tone === "kind"
          ? "border-accent bg-accent-soft text-ink"
          : tone === "muted"
            ? "border-border text-ink-faint"
            : "border-border bg-surface-raised text-ink-muted",
      )}
    >
      {dotColor ? <CategoryDot color={dotColor} /> : null}
      {label}
    </span>
  );
}

function DetailsEditor({
  draft,
  setDraft,
  categories,
}: {
  draft: ParsedDraft;
  setDraft: React.Dispatch<React.SetStateAction<ParsedDraft | null>>;
  categories: Category[];
}) {
  const anchor = draft.startIso ?? draft.dueIso;
  const d = anchor ? new Date(anchor) : null;
  const dateVal = d ? isoDay(d) : "";
  const timeVal = d && !draft.allDay ? timeValue(d) : "";

  function setAnchor(dateStr: string, timeStr: string) {
    if (!dateStr) {
      setDraft((v) => (v ? { ...v, startIso: null, endIso: null, dueIso: null } : v));
      return;
    }
    const nd = instantFromWallClock(dateStr, timeStr || "09:00");
    const iso = nd.toISOString();
    setDraft((v) => {
      if (!v) return v;
      const dur =
        v.startIso && v.endIso
          ? new Date(v.endIso).getTime() - new Date(v.startIso).getTime()
          : 60 * 60000;
      return v.kind === "task"
        ? { ...v, dueIso: iso, allDay: !timeStr }
        : {
            ...v,
            startIso: iso,
            endIso: new Date(nd.getTime() + dur).toISOString(),
            allDay: !timeStr,
          };
    });
  }

  return (
    <div className="grid grid-cols-2 gap-3 rounded-(--radius-sm) border border-border bg-surface-raised/50 p-3">
      <Field label="Type" htmlFor="qa-kind">
        <select
          id="qa-kind"
          value={draft.kind}
          onChange={(e) => {
            const kind = e.target.value as ParsedDraft["kind"];
            setDraft((v) => {
              if (!v) return v;
              // Carry the anchor across the event↔task boundary — switching
              // type must never silently drop the date into the Inbox.
              const anchor = v.startIso ?? v.dueIso;
              if (kind === "task") {
                return { ...v, kind, dueIso: anchor, startIso: null, endIso: null };
              }
              const dur =
                v.startIso && v.endIso
                  ? new Date(v.endIso).getTime() - new Date(v.startIso).getTime()
                  : 60 * 60000;
              return {
                ...v,
                kind,
                startIso: anchor,
                endIso: anchor ? new Date(new Date(anchor).getTime() + dur).toISOString() : null,
                dueIso: null,
              };
            });
          }}
          className="h-10 rounded-(--radius-sm) border border-border-input bg-surface px-2 text-sm text-ink"
        >
          <option value="event">Event</option>
          <option value="task">Task (deadline)</option>
          <option value="habit">Habit</option>
        </select>
      </Field>
      <Field label="Category" htmlFor="qa-cat">
        <select
          id="qa-cat"
          value={draft.categoryName ?? ""}
          onChange={(e) =>
            setDraft((v) => (v ? { ...v, categoryName: e.target.value || null } : v))
          }
          className="h-10 rounded-(--radius-sm) border border-border-input bg-surface px-2 text-sm text-ink"
        >
          <option value="">None</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Date" htmlFor="qa-date">
        <Input
          id="qa-date"
          type="date"
          value={dateVal}
          onChange={(e) => setAnchor(e.target.value, timeVal)}
        />
      </Field>
      <Field label="Time" htmlFor="qa-time">
        <Input
          id="qa-time"
          type="time"
          value={timeVal}
          onChange={(e) => setAnchor(dateVal, e.target.value)}
        />
      </Field>
      {draft.kind === "habit" ? (
        <Field label="Days per week" htmlFor="qa-target" className="col-span-2">
          <Input
            id="qa-target"
            type="number"
            min={1}
            max={7}
            value={draft.habitTargetPerWeek ?? 7}
            onChange={(e) =>
              setDraft((v) =>
                v ? { ...v, habitTargetPerWeek: Number(e.target.value) || 7 } : v,
              )
            }
          />
        </Field>
      ) : null}
    </div>
  );
}
