"use client";

/**
 * Scheduling preferences — the roadmap calls for configurable transition
 * buffers; day window and daily study ceiling belong with them (a night-owl
 * with 8 AM labs needs different numbers than the default).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { saveSchedulingPrefs } from "@/server/analytics";

const BUFFERS = [0, 5, 10, 15, 20, 30];
const CAPS = [120, 180, 240, 300, 360];

export function SchedulingPanel({
  initial,
}: {
  initial: {
    bufferMinutes: number;
    dayStart: string;
    dayEnd: string;
    maxPlanMinutesPerDay: number;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [buffer, setBuffer] = React.useState(initial.bufferMinutes);
  const [dayStart, setDayStart] = React.useState(initial.dayStart);
  const [dayEnd, setDayEnd] = React.useState(initial.dayEnd);
  const [cap, setCap] = React.useState(initial.maxPlanMinutesPerDay);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const dirty =
    buffer !== initial.bufferMinutes ||
    dayStart !== initial.dayStart ||
    dayEnd !== initial.dayEnd ||
    cap !== initial.maxPlanMinutesPerDay;

  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await saveSchedulingPrefs({
        bufferMinutes: buffer,
        dayStart,
        dayEnd,
        maxPlanMinutesPerDay: cap,
      });
      if (res?.error) {
        setError(res.error);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader title="Planning" />
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-muted">
            Transition buffer
          </span>
          <div className="flex flex-wrap gap-1.5">
            {BUFFERS.map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={buffer === b}
                onClick={() => setBuffer(b)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  buffer === b
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-border text-ink-muted hover:border-border-strong",
                )}
              >
                {b === 0 ? "None" : `${b} min`}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-faint">
            Breathing room kept around every commitment when planning — and the
            gap below which two classes get a &ldquo;can you even get there?&rdquo; warning.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Day starts" htmlFor="sched-start">
            <input
              id="sched-start"
              type="time"
              value={dayStart}
              onChange={(e) => setDayStart(e.target.value)}
              className="h-10 w-full rounded-(--radius-sm) border border-border bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
          </Field>
          <Field label="Day ends" htmlFor="sched-end">
            <input
              id="sched-end"
              type="time"
              value={dayEnd}
              onChange={(e) => setDayEnd(e.target.value)}
              className="h-10 w-full rounded-(--radius-sm) border border-border bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
          </Field>
        </div>
        <p className="-mt-2 text-xs text-ink-faint">
          Nothing gets planned outside these hours, and free-time totals count
          only this window.
        </p>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-muted">
            Most study a day should hold
          </span>
          <div className="flex flex-wrap gap-1.5">
            {CAPS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={cap === c}
                onClick={() => setCap(c)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  cap === c
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-border text-ink-muted hover:border-border-strong",
                )}
              >
                {c / 60}h
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-faint">
            Stops &ldquo;plan my week&rdquo; from paving over every free hour.
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button
          size="sm"
          className="self-start"
          disabled={pending || !dirty}
          onClick={save}
        >
          {pending ? "Saving…" : saved ? "Saved ✓" : "Save planning settings"}
        </Button>
      </CardBody>
    </Card>
  );
}
