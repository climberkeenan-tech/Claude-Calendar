"use client";

/**
 * Recharts is ~105 KB gzipped — a third of everything the analytics page
 * ships. Loading it lazily lets the numbers (KPIs, score, bar lists) paint
 * immediately; the two chart cards fill in a moment later behind a skeleton
 * of the right height, so nothing below them jumps.
 */
import dynamic from "next/dynamic";

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading chart"
      className="animate-pulse rounded-(--radius-sm) bg-surface-raised"
      style={{ height }}
    />
  );
}

export const FocusTimeline = dynamic(
  () => import("./charts").then((m) => m.FocusTimeline),
  { ssr: false, loading: () => <ChartSkeleton height={180} /> },
);

export const TrendLine = dynamic(
  () => import("./charts").then((m) => m.TrendLine),
  { ssr: false, loading: () => <ChartSkeleton height={140} /> },
);
