"use client";

import * as React from "react";
import { useActionState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { isTypingTarget } from "@/components/shortcuts/shortcuts-overlay";
import { createEvent, type CreateEventState } from "@/server/events";
import { CategoryDot } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Category = { id: string; name: string; color: string };

export function QuickAdd({ categories }: { categories: Category[] }) {
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<"event" | "task">("event");
  const [categoryId, setCategoryId] = React.useState<string>("");
  const [state, formAction, pending] = useActionState<CreateEventState, FormData>(
    async (prev, formData) => {
      const result = await createEvent(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    {},
  );

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key.toLowerCase() === "q") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const today = new Date();
  const defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Quick add"
          description="Natural-language input arrives in Phase 3 — for now, the essentials."
        >
          <form action={formAction} className="flex flex-col gap-4">
            <Field label="Title" htmlFor="qa-title">
              <Input
                id="qa-title"
                name="title"
                placeholder={kind === "event" ? "Study session, gym, dinner…" : "Bio homework, essay draft…"}
                autoFocus
                required
                maxLength={300}
              />
            </Field>

            <div className="flex gap-2" role="radiogroup" aria-label="Type">
              {(["event", "task"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "flex-1 rounded-(--radius-sm) border px-3 py-2 text-sm font-medium transition-colors",
                    kind === k
                      ? "border-accent bg-accent-soft text-ink"
                      : "border-border text-ink-muted hover:border-border-strong",
                  )}
                >
                  {k === "event" ? "Scheduled event" : "Task with deadline"}
                </button>
              ))}
            </div>
            <input type="hidden" name="kind" value={kind} />

            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" htmlFor="qa-date">
                <Input id="qa-date" name="date" type="date" defaultValue={defaultDate} required />
              </Field>
              <Field label={kind === "event" ? "Start time" : "Due time"} htmlFor="qa-time">
                <Input id="qa-time" name="time" type="time" />
              </Field>
            </div>

            {kind === "event" ? (
              <Field label="Duration (minutes)" htmlFor="qa-duration">
                <Input
                  id="qa-duration"
                  name="durationMinutes"
                  type="number"
                  min={5}
                  max={1440}
                  step={5}
                  defaultValue={60}
                />
              </Field>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-muted">Category</span>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategoryId(categoryId === c.id ? "" : c.id)}
                    aria-pressed={categoryId === c.id}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      categoryId === c.id
                        ? "border-accent bg-accent-soft text-ink"
                        : "border-border text-ink-muted hover:border-border-strong",
                    )}
                  >
                    <CategoryDot color={c.color} />
                    {c.name}
                  </button>
                ))}
              </div>
              <input type="hidden" name="categoryId" value={categoryId} />
            </div>

            {state.error ? (
              <p role="alert" className="text-sm text-danger">
                {state.error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Adding…" : "Add"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
