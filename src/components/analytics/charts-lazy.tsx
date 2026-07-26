"use client";

/**
 * Recharts is ~105 KB gzipped — a third of everything the analytics page
 * ships. Loading it lazily lets the numbers (KPIs, score, bar lists) paint
 * immediately; the two chart cards fill in a moment later behind a skeleton
 * of the right height, so nothing below them jumps.
 */
import dynamic from "next/dynamic";

/**
 * `loading` doubles as the FAILURE state — Next renders it with an `error`
 * once the chunk gives up. Rendering the skeleton regardless left a card
 * pulsing forever with no hint that it had stopped trying.
 */
function ChartFallback({
  height,
  error,
  retry,
}: {
  height: number;
  error?: Error | null;
  retry?: () => void;
}) {
  if (error) {
    return (
      <div
        role="alert"
        style={{ height }}
        className="flex flex-col items-center justify-center gap-2 rounded-(--radius-sm) border border-border bg-surface text-center"
      >
        <p className="text-xs text-ink-muted">This chart didn&rsquo;t load.</p>
        <button
          type="button"
          onClick={() => retry?.()}
          className="text-xs font-medium text-accent-ink underline-offset-2 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <div
      aria-busy="true"
      aria-label="Loading chart"
      className="animate-pulse rounded-(--radius-sm) bg-surface-raised"
      style={{ height }}
    />
  );
}

// Heights match the charts themselves (h-48 = 192, h-36 = 144) so the card
// doesn't resize under the reader when the chunk lands.
export const FocusTimeline = dynamic(
  () => import("./charts").then((m) => m.FocusTimeline),
  {
    ssr: false,
    loading: (props) => <ChartFallback height={192} {...props} />,
  },
);

export const TrendLine = dynamic(
  () => import("./charts").then((m) => m.TrendLine),
  {
    ssr: false,
    loading: (props) => <ChartFallback height={144} {...props} />,
  },
);
