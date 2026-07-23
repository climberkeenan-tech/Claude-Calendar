"use client";

import * as React from "react";
import { CategoryDot } from "@/components/ui/badge";
import { fmtTime, leftLabel, untilLabel } from "@/lib/time";

export type HeroItem = {
  id: string;
  title: string;
  kind: "event" | "task" | "habit";
  startsAt: Date | null;
  endsAt: Date | null;
  dueAt: Date | null;
  location: string | null;
  categoryColor: string | null;
};

function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function NowNext({
  current,
  next,
}: {
  current: HeroItem | null;
  next: HeroItem | null;
}) {
  const now = useNow();

  const nextAt = next ? (next.startsAt ?? next.dueAt) : null;

  return (
    <section
      aria-label="Now and next"
      className="rounded-(--radius) border border-border bg-surface p-6 shadow-soft md:p-8"
    >
      <div className="grid gap-6 md:grid-cols-2">
        {/* NOW */}
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-faint">
            Now
          </p>
          {current ? (
            <>
              <h1 className="font-display text-3xl leading-tight text-ink md:text-4xl">
                {current.title}
              </h1>
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                {current.categoryColor ? (
                  <CategoryDot color={current.categoryColor} />
                ) : null}
                {current.endsAt ? (
                  <span className="font-mono text-accent">
                    {leftLabel(now, current.endsAt)}
                  </span>
                ) : null}
                {current.location ? <span>· {current.location}</span> : null}
              </p>
            </>
          ) : (
            <>
              <h1 className="font-display text-3xl leading-tight text-ink md:text-4xl">
                Free right now
              </h1>
              <p className="text-sm text-ink-muted">
                Nothing on the calendar this minute.
              </p>
            </>
          )}
        </div>

        {/* NEXT */}
        <div className="flex flex-col gap-1.5 border-t border-border pt-5 md:border-l md:border-t-0 md:pl-8 md:pt-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-faint">
            Next
          </p>
          {next && nextAt ? (
            <>
              <p className="font-display text-2xl leading-tight text-ink md:text-3xl">
                {next.title}
              </p>
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                {next.categoryColor ? (
                  <CategoryDot color={next.categoryColor} />
                ) : null}
                <span className="font-mono text-accent">
                  {untilLabel(now, nextAt)}
                </span>
                <span>· {fmtTime(nextAt)}</span>
                {next.kind === "task" ? <span>· due</span> : null}
              </p>
            </>
          ) : (
            <>
              <p className="font-display text-2xl leading-tight text-ink md:text-3xl">
                Nothing scheduled
              </p>
              <p className="text-sm text-ink-muted">
                Press <kbd className="rounded border border-border bg-surface-raised px-1.5 font-mono text-xs">Q</kbd> to
                add what&apos;s next.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
