"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  applyInsight,
  dismissInsight,
  type InsightRow,
} from "@/server/insights";

const KIND_ICON: Record<string, string> = {
  study_suggestion: "📖",
  conflict: "⚡",
  starter_block_suggestion: "🌱",
  busy_week_warning: "🌊",
  schedule_improvement: "✨",
  time_estimate: "⏱",
};

export function InsightsDigest({ initial }: { initial: InsightRow[] }) {
  const router = useRouter();
  const [items, setItems] = React.useState(initial);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const [prev, setPrev] = React.useState(initial);
  if (prev !== initial) {
    setPrev(initial);
    setItems(initial);
  }

  return (
    <Card>
      <CardHeader title="From Claude" />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState
            headline="No suggestions right now"
            hint="Up to three appear each morning — only when there's a genuinely useful move."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {error ? (
              <li role="alert" className="text-xs text-danger-ink">
                {error}
              </li>
            ) : null}
            {items.map((ins) => (
              <li key={ins.id} className="flex flex-col gap-1.5">
                <p className="text-sm font-medium text-ink">
                  <span aria-hidden className="mr-1.5">
                    {KIND_ICON[ins.kind] ?? "✦"}
                  </span>
                  {ins.title}
                </p>
                <p className="text-xs leading-relaxed text-ink-muted">{ins.body}</p>
                <div className="flex items-center gap-2">
                  {ins.hasAction ? (
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          // A throw inside startTransition is swallowed, so
                          // without this the button just did nothing at all —
                          // no error, no change, nothing to retry against.
                          let r: Awaited<ReturnType<typeof applyInsight>>;
                          try {
                            r = await applyInsight(ins.id);
                          } catch {
                            setError("Couldn't do that — check your connection and try again.");
                            setTimeout(() => setError(null), 4000);
                            return;
                          }
                          if (r.error) {
                            setError(r.error);
                            setTimeout(() => setError(null), 4000);
                            return;
                          }
                          setItems((l) => l.filter((i) => i.id !== ins.id));
                          router.refresh();
                        })
                      }
                    >
                      Do it
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      // Hide it immediately — dismissing should feel instant —
                      // but put it back if the write didn't land, rather than
                      // leaving the card gone here and still there on reload.
                      setItems((l) => l.filter((i) => i.id !== ins.id));
                      startTransition(async () => {
                        try {
                          await dismissInsight(ins.id);
                        } catch {
                          setItems((l) =>
                            l.some((i) => i.id === ins.id) ? l : [...l, ins],
                          );
                          setError("Couldn't dismiss that — try again.");
                          setTimeout(() => setError(null), 4000);
                        }
                      });
                    }}
                  >
                    Not now
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
