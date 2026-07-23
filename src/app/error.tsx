"use client";

/** Root backstop boundary (outside the app shell). */
export default function RootError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-2xl text-ink">Something went wrong</h1>
      <p className="max-w-sm text-sm text-ink-muted">
        Reload to pick up where you left off — nothing you saved is lost.
      </p>
      <button
        onClick={reset}
        className="h-10 rounded-(--radius-sm) bg-accent px-4 text-sm font-medium text-accent-text hover:bg-accent-hover"
      >
        Reload
      </button>
    </main>
  );
}
