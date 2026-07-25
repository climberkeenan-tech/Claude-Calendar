"use client";

/**
 * Plan review — the whole point is speed: everything defaults to checked,
 * one Accept lands the week. Unchecking is the edit. (<5 minutes including
 * review is the phase's success criterion.)
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { fmtTime } from "@/lib/time";
import {
  acceptPlan,
  undoPlan,
  type AcceptResult,
  type PlanContext,
} from "@/server/planning";

const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export function PlanReview({ context }: { context: PlanContext }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [rejected, setRejected] = React.useState<Set<number>>(new Set());
  const [result, setResult] = React.useState<AcceptResult | null>(null);
  const [undone, setUndone] = React.useState(false);

  const byDay = new Map<string, { index: number; p: PlanContext["proposals"][number] }[]>();
  context.proposals.forEach((p, index) => {
    const list = byDay.get(p.dayIso) ?? [];
    list.push({ index, p });
    byDay.set(p.dayIso, list);
  });
  const acceptedCount = context.proposals.length - rejected.size;

  const toggle = (index: number) =>
    setRejected((r) => {
      const next = new Set(r);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const accept = () =>
    startTransition(async () => {
      const blocks = context.proposals
        .filter((_, i) => !rejected.has(i))
        .map((p) => ({ taskId: p.taskId, startIso: p.startIso, minutes: p.minutes }));
      const res = await acceptPlan({
        blocks,
        sweepBlockIds: context.staleBlockIds,
      });
      setResult(res);
      if (res.ok) router.refresh();
    });

  if (result?.ok) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
          <span aria-hidden className="text-2xl">✓</span>
          <p className="text-sm font-medium text-ink">
            {result.created} block{result.created === 1 ? "" : "s"} on the calendar.
            {result.skipped ? ` ${result.skipped} skipped (the calendar moved).` : ""}
          </p>
          {undone ? (
            <p className="text-xs text-ink-faint">Undone — nothing was kept.</p>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => router.push("/calendar")}>
                View calendar
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await undoPlan(result.batchId!);
                    setUndone(true);
                    router.refresh();
                  })
                }
              >
                Undo
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    );
  }

  if (context.proposals.length === 0) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-sm font-medium text-ink">
            {context.taskCount === 0
              ? "Nothing needs planning — no open dated tasks in this window."
              : "No open slots fit before these deadlines."}
          </p>
          <p className="max-w-sm text-xs text-ink-faint">
            {context.taskCount === 0
              ? "Capture work with Q (\"essay due Friday\") and plan it here."
              : "Triage what slipped — move, shrink, or drop — then regenerate."}
          </p>
          {context.taskCount > 0 ? (
            <Link href="/assignments" className="text-sm text-accent hover:underline">
              Go to triage →
            </Link>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {context.focusHint ? (
        <p className="text-xs text-ink-faint">✦ {context.focusHint}</p>
      ) : null}

      {context.warnings.length > 0 ? (
        <div className="rounded-(--radius) border border-warn/40 bg-warn-soft p-3 text-sm text-ink">
          {context.warnings.map((w) => (
            <p key={`${w.from}-${w.to}`}>
              ⚠ {w.from} → {w.to}: only {w.gapMinutes} min to get across campus.
            </p>
          ))}
        </div>
      ) : null}

      {context.overload.length > 0 ? (
        <div className="rounded-(--radius) border border-border bg-surface-raised p-3 text-sm text-ink-muted">
          {context.overload.map((o) => (
            <p key={o.dayIso}>
              {dayLabel(o.dayIso)} is overloaded: ~{Math.round(o.taskMinutes / 60)}h due,{" "}
              {Math.round(o.freeMinutes / 60)}h free — start earlier or triage.
            </p>
          ))}
        </div>
      ) : null}

      {[...byDay.entries()].map(([dayIso, list]) => (
        <Card key={dayIso}>
          <CardHeader title={dayLabel(dayIso)} />
          <CardBody className="flex flex-col divide-y divide-border">
            {list.map(({ index, p }) => {
              const off = rejected.has(index);
              const start = new Date(p.startIso);
              const end = new Date(start.getTime() + p.minutes * 60_000);
              return (
                <label
                  key={index}
                  className={`flex cursor-pointer items-center gap-3 py-2.5 ${off ? "opacity-45" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={!off}
                    onChange={() => toggle(index)}
                    className="size-4 accent-(--accent)"
                    aria-label={`Include ${p.taskTitle} at ${fmtTime(start)}`}
                  />
                  <span className="w-28 shrink-0 font-mono text-xs text-ink-muted">
                    {fmtTime(start)}–{fmtTime(end)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {p.taskTitle}
                  </span>
                  <span className="shrink-0 text-xs text-ink-faint">{p.minutes}m</span>
                </label>
              );
            })}
          </CardBody>
        </Card>
      ))}

      {context.unplaceable.length > 0 ? (
        <p className="text-xs text-ink-faint">
          Couldn&apos;t fit: {context.unplaceable.map((u) => u.title).join(", ")} —
          free a slot or{" "}
          <Link href="/assignments" className="text-accent hover:underline">
            triage
          </Link>
          .
        </p>
      ) : null}

      {result?.error ? (
        <p role="alert" className="text-sm text-danger">
          {result.error}
        </p>
      ) : null}

      <div className="sticky bottom-16 z-20 flex items-center justify-between gap-3 rounded-(--radius) border border-border bg-surface/95 p-3 shadow-soft backdrop-blur md:bottom-4">
        <p className="text-sm text-ink-muted">
          <span className="font-medium text-ink">{acceptedCount}</span> block
          {acceptedCount === 1 ? "" : "s"}
          {context.staleBlockIds.length > 0
            ? ` · sweeps ${context.staleBlockIds.length} stale block${context.staleBlockIds.length === 1 ? "" : "s"}`
            : ""}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => router.refresh()}
          >
            Regenerate
          </Button>
          <Button size="sm" disabled={pending || acceptedCount === 0} onClick={accept}>
            {pending ? "Adding…" : "Accept plan"}
          </Button>
        </div>
      </div>
    </div>
  );
}
