"use client";

/**
 * Server actions that return `void` throw on failure, and a bare
 * `startTransition(async () => { await action() })` swallows that throw — the
 * click just does nothing. For someone with ADHD, "did that save?" is worse
 * than an error: it costs a re-check every time. Every mutation says so when
 * it fails.
 */
import * as React from "react";

export function useActionGuard() {
  const [error, setError] = React.useState<string | null>(null);
  const run = React.useCallback(
    async (fn: () => Promise<unknown>, whenItFails: string): Promise<boolean> => {
      setError(null);
      try {
        await fn();
        return true;
      } catch {
        setError(whenItFails);
        return false;
      }
    },
    [],
  );
  return { error, setError, run };
}

export function ActionError({
  message,
  className,
}: {
  message: string | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p role="alert" className={className ?? "text-xs text-danger-ink"}>
      {message}
    </p>
  );
}
