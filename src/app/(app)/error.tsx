"use client";

import { Button } from "@/components/ui/button";

/** Segment error boundary — a failed action or query shows a calm recovery
 * card inside the shell, never a blank "Application error" page. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <div
        aria-hidden
        className="flex size-12 items-center justify-center rounded-2xl bg-warn-soft text-xl"
      >
        ⚠
      </div>
      <h1 className="font-display text-2xl text-ink">That didn&apos;t save</h1>
      <p className="text-sm text-ink-muted">
        Something went wrong talking to the server. Nothing was lost — your
        data is exactly as it was before the last action.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-ink-faint">ref: {error.digest}</p>
      ) : null}
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
