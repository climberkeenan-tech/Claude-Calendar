"use client";

/**
 * Suggestion surfaces — best study time, break, deep work, movement, sleep
 * wind-down. Each is one click to accept; each says why. Dismissal is local
 * and silent (a suggestion you ignore should never become a chore).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { fmtTime } from "@/lib/time";
import { acceptSuggestion } from "@/server/planning";
import type { PlanContext } from "@/server/planning";

const ICON: Record<string, string> = {
  best_study_time: "✦",
  break: "☕",
  deep_work: "◆",
  movement: "▲",
  sleep_consistency: "☾",
};

export function Suggestions({
  suggestions,
}: {
  suggestions: PlanContext["suggestions"];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [dismissed, setDismissed] = React.useState<Set<number>>(new Set());
  const [error, setError] = React.useState<string | null>(null);

  const visible = suggestions
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => !dismissed.has(i));
  if (visible.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Worth claiming today" />
      <CardBody className="flex flex-col divide-y divide-border">
        {visible.map(({ s, i }) => {
          const start = new Date(s.startIso);
          return (
            <div key={i} className="flex items-start gap-3 py-3">
              <span aria-hidden className="mt-0.5 text-base text-accent-ink">
                {ICON[s.kind] ?? "✦"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{s.title}</p>
                <p className="text-xs text-ink-muted">{s.rationale}</p>
                <p className="mt-0.5 font-mono text-xs text-ink-faint">
                  {fmtTime(start)} · {s.minutes} min
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setError(null);
                      const res = await acceptSuggestion({
                        title: s.eventTitle,
                        startIso: s.startIso,
                        minutes: s.minutes,
                        categoryName: s.categoryName,
                      });
                      if (res.error) setError(res.error);
                      else {
                        setDismissed((d) => new Set(d).add(i));
                        router.refresh();
                      }
                    })
                  }
                >
                  Add it
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Dismiss suggestion"
                  onClick={() => setDismissed((d) => new Set(d).add(i))}
                >
                  ✕
                </Button>
              </div>
            </div>
          );
        })}
        {error ? (
          <p role="alert" className="pt-2 text-xs text-danger-ink">
            {error}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
