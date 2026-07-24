"use client";

/**
 * The two Recharts pieces: the 14-day focus timeline (columns) and the
 * 8-week trend small-multiples (two separate single-series lines — NEVER a
 * dual-axis chart). Single series everywhere → no legend boxes; identity
 * comes from each card's title. Marks wear the validated --chart-mark hue.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMins } from "./bits";

const AXIS_TICK = {
  fill: "var(--text-faint)",
  fontSize: 11,
} as const;

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: { value?: number | string; payload?: { full?: string } }[];
  label?: string;
  formatter: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const v = Number(payload[0]?.value ?? 0);
  // Prefer the unambiguous date ("Sep 15") over a bare weekday label that
  // repeats across a two-week window.
  const title = payload[0]?.payload?.full ?? label;
  return (
    <div className="rounded-(--radius-sm) border border-border bg-surface-raised px-2.5 py-1.5 text-xs shadow-raised">
      <p className="text-ink-faint">{title}</p>
      <p className="font-medium text-ink">{formatter(v)}</p>
    </div>
  );
}

const shortDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });

const monthDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** Last 14 days of focus, one bar per day. */
export function FocusTimeline({
  data,
}: {
  data: { day: string; minutes: number; tasks: number }[];
}) {
  const rows = data.map((d) => ({
    ...d,
    label: shortDay(d.day),
    full: monthDay(d.day),
  }));
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid
            vertical={false}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
            interval={1}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={46}
            tickFormatter={(v: number) => fmtMins(v)}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "var(--accent-soft)", opacity: 0.6 }}
            content={
              <ChartTooltip
                formatter={(v) => `${fmtMins(v)} of focus`}
              />
            }
            labelFormatter={undefined}
          />
          <Bar
            dataKey="minutes"
            fill="var(--chart-mark)"
            radius={[4, 4, 0, 0]}
            maxBarSize={20}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** One small single-series line — used twice, side by side. Props stay
 * serializable (this crosses the RSC boundary — no function props). */
export function TrendLine({
  data,
  dataKey,
  unit,
}: {
  data: { weekOf: string; focusMinutes: number; tasksCompleted: number }[];
  dataKey: "focusMinutes" | "tasksCompleted";
  unit: "minutes" | "tasks";
}) {
  const formatter = (v: number) =>
    unit === "minutes" ? `${fmtMins(v)} of focus` : `${v} task${v === 1 ? "" : "s"} done`;
  const rows = data.map((d) => ({ ...d, label: monthDay(d.weekOf) }));
  return (
    <div className="h-36 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid
            vertical={false}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v: number) =>
              dataKey === "focusMinutes" ? fmtMins(v) : String(v)
            }
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
            content={<ChartTooltip formatter={formatter} />}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke="var(--chart-mark)"
            strokeWidth={2}
            strokeLinecap="round"
            dot={false}
            activeDot={{
              r: 4,
              fill: "var(--chart-mark)",
              stroke: "var(--surface)",
              strokeWidth: 2,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
