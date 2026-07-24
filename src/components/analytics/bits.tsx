/**
 * Server-renderable analytics pieces: stat tiles, bar-lists, heatmap, meter.
 * Chart colors come from the validated --chart-* tokens; identity always
 * rides a text label beside the mark, never color alone.
 */
import { cn } from "@/lib/utils";

export function fmtMins(m: number): string {
  if (m < 60) return `${m}m`;
  const h = m / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

// ---------------------------------------------------------------------------
// Stat tile (label · value · optional delta)
// ---------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  sub,
  delta,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: { text: string; good: boolean } | null;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-(--radius) border border-border bg-surface p-4 shadow-soft">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="text-2xl font-semibold text-ink">{value}</p>
      {delta ? (
        <p className={cn("text-xs", delta.good ? "text-ok" : "text-ink-faint")}>
          {delta.text}
        </p>
      ) : sub ? (
        <p className="text-xs text-ink-faint">{sub}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar list — magnitude per labeled entity (categories, courses)
// ---------------------------------------------------------------------------

export function BarList({
  rows,
  unit,
}: {
  rows: { name: string; value: number; color: string | null; hint?: string }[];
  unit: "minutes";
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.name} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: r.color ?? "var(--chart-mark)" }}
              />
              <span className="truncate text-ink">{r.name}</span>
              {r.hint ? (
                <span className="shrink-0 text-xs text-ink-faint">{r.hint}</span>
              ) : null}
            </span>
            <span className="shrink-0 font-mono text-xs text-ink-muted">
              {unit === "minutes" ? fmtMins(r.value) : r.value}
              {total > 0 ? (
                <span className="ml-1.5 text-ink-faint">
                  {Math.round((r.value / total) * 100)}%
                </span>
              ) : null}
            </span>
          </div>
          {/* Magnitude bars all wear the validated mark hue (nominal rows
              never get a value-or-entity ramp); identity lives in the dot +
              label above. Raw entity hexes aren't restepped for dark mode
              and several sit under the 3:1 mark floor. */}
          <div className="h-2 overflow-hidden rounded-full bg-surface-raised border border-border/60">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, (r.value / max) * 100)}%`,
                background: "var(--chart-mark)",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Productive-days heatmap — 12 weeks × Mon–Sun, sequential ramp
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];

export function Heatmap({
  cells,
}: {
  cells: { day: string; weekday: number; minutes: number; tasks: number; bin: number }[];
}) {
  const weeks: (typeof cells)[] = [];
  for (const c of cells) {
    if (c.weekday === 0) weeks.push([]);
    weeks[weeks.length - 1]?.push(c);
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 overflow-x-auto pb-1">
        <div
          aria-hidden
          className="grid shrink-0 grid-rows-7 gap-[3px] pr-1 text-[10px] leading-none text-ink-faint"
        >
          {WEEKDAY_LABELS.map((l, i) => (
            <span key={i} className="flex h-3.5 items-center">
              {l}
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid shrink-0 grid-rows-7 gap-[3px]">
            {week.map((c) => {
              const label = `${c.day}: ${c.minutes} focus min, ${c.tasks} task${c.tasks === 1 ? "" : "s"} done`;
              return (
                <div
                  key={c.day}
                  role="img"
                  aria-label={label}
                  title={label}
                  className="size-3.5 rounded-[3px]"
                  style={{ background: `var(--chart-ramp-${c.bin})` }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-ink-faint">
        quieter
        {[0, 1, 2, 3, 4].map((b) => (
          <span
            key={b}
            aria-hidden
            className="size-2.5 rounded-[2px]"
            style={{ background: `var(--chart-ramp-${b})` }}
          />
        ))}
        busier · focus minutes + 25 per finished task
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meter — semester progress
// ---------------------------------------------------------------------------

export function Meter({
  pct,
  startLabel,
  endLabel,
}: {
  pct: number;
  startLabel: string;
  endLabel: string;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Semester ${clamped}% complete`}
        className="h-2.5 overflow-hidden rounded-full bg-accent-soft"
      >
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-ink-faint">
        <span>{startLabel}</span>
        <span className="font-medium text-ink-muted">{clamped}% through</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "View as numbers" — the table-view twin every chart ships with
// ---------------------------------------------------------------------------

export function NumbersTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-ink-faint hover:text-ink-muted">
        View as numbers
      </summary>
      <div className="mt-2 max-h-56 overflow-y-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="text-left text-ink-faint">
              {head.map((h) => (
                <th key={h} className="py-1 pr-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums text-ink-muted">
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border/60">
                {r.map((cell, j) => (
                  <td key={j} className="py-1 pr-3">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
