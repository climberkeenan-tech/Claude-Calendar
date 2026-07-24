"use client";

/**
 * The productivity score, presented per its guardrails: weekly framing,
 * wins + ONE next action first, the number on tap, formula always
 * explainable, hideable everywhere it appears.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { setScoreVisibility } from "@/server/analytics";
import type { ScoreView } from "@/lib/analytics/summary";

export function ScoreCard({
  view,
  hiddenFallback = "affordance",
}: {
  view: ScoreView;
  /** "affordance" (analytics) keeps a show-again link; "none" (dashboard)
   * makes hidden mean GONE. */
  hiddenFallback?: "affordance" | "none";
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [showNumber, setShowNumber] = React.useState(false);

  const toggle = (visible: boolean) =>
    startTransition(async () => {
      await setScoreVisibility(visible);
      router.refresh();
    });

  if (!view.visible) {
    if (hiddenFallback === "none") return null;
    return (
      <p className="text-xs text-ink-faint">
        Productivity score is hidden.{" "}
        <button
          type="button"
          disabled={pending}
          onClick={() => toggle(true)}
          className="text-accent underline-offset-2 hover:underline"
        >
          Show it again
        </button>
      </p>
    );
  }

  if (view.score === null) {
    return null; // no components yet — nothing to judge, so say nothing
  }

  return (
    <Card>
      <CardHeader
        title="This week"
        action={
          <button
            type="button"
            disabled={pending}
            onClick={() => toggle(false)}
            className="text-xs text-ink-faint hover:text-ink-muted"
          >
            Hide
          </button>
        }
      />
      <CardBody className="flex flex-col gap-3">
        {view.wins.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {view.wins.map((w) => (
              <li key={w} className="flex items-start gap-2 text-sm text-ink">
                <span aria-hidden className="mt-0.5 text-ok">
                  ✓
                </span>
                {w}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-sm text-ink-muted">{view.nextAction}</p>

        {showNumber ? (
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-semibold text-ink">{view.score}</span>
            <span className="text-sm text-ink-faint">out of 100 this week</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowNumber(true)}
            className="self-start text-xs text-accent underline-offset-2 hover:underline"
          >
            Show the number
          </button>
        )}

        <details>
          <summary className="cursor-pointer text-xs text-ink-faint hover:text-ink-muted">
            How this is calculated
          </summary>
          <div className="mt-2 flex flex-col gap-1.5 text-xs text-ink-muted">
            {view.parts.map((p) => {
              const totalWeight = view.parts.reduce((a, x) => a + x.weight, 0);
              return (
                <div key={p.key} className="flex items-baseline justify-between gap-3">
                  <span>
                    {p.label}{" "}
                    <span className="text-ink-faint">
                      · {Math.round((p.weight / totalWeight) * 100)}% of the score
                    </span>
                  </span>
                  <span className="shrink-0 font-mono">{p.detail}</span>
                </div>
              );
            })}
            <p className="mt-1 text-ink-faint">
              Weekly, never daily. Anything you didn&apos;t track this week
              (like the focus timer) drops out instead of counting against
              you.
            </p>
          </div>
        </details>
      </CardBody>
    </Card>
  );
}

/** Compact dashboard twin — one win or the next action, score on the far
 * side, one click to the full picture. Hidden = renders nothing at all. */
export function ScoreTile({ view }: { view: ScoreView }) {
  if (!view.visible || view.score === null) return null;
  return (
    <Link
      href="/analytics"
      className="flex items-center justify-between gap-3 rounded-(--radius) border border-border bg-surface px-4 py-3 shadow-soft transition-colors hover:border-border-strong"
    >
      <span className="min-w-0 text-sm text-ink-muted">
        <span className="mr-1.5" aria-hidden>
          ✦
        </span>
        {view.wins[0] ?? view.nextAction}
      </span>
      <span className="shrink-0 text-sm font-semibold text-ink">
        {view.score}
        <span className="ml-0.5 font-normal text-ink-faint">/100</span>
      </span>
    </Link>
  );
}
