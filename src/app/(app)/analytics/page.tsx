import { requireUserId } from "@/lib/auth";
import { assembleAnalytics } from "@/lib/analytics/summary";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import {
  BarList,
  Heatmap,
  Meter,
  NumbersTable,
  StatTile,
  fmtMins,
} from "@/components/analytics/bits";
import { FocusTimeline, TrendLine } from "@/components/analytics/charts";
import { ScoreCard } from "@/components/analytics/score-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics" };

const monthDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export default async function AnalyticsPage() {
  const userId = await requireUserId();
  const data = await assembleAnalytics(userId);

  // Habit-only use is still use — the score and Habits KPI must not hide
  // behind a "finish a task first" wall.
  const hasAnyData =
    data.timeline.some((d) => d.minutes > 0 || d.tasks > 0) ||
    data.heatmap.some((c) => c.bin > 0) ||
    data.kpis.tasksDoneWeek > 0 ||
    data.kpis.habitsTotal > 0 ||
    data.score.score !== null;

  const focusDelta = data.kpis.focusMinutesWeek - data.kpis.focusMinutesLastWeek;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <h1 className="font-display text-2xl text-ink">Analytics</h1>

      {!hasAnyData ? (
        <Card>
          <CardBody>
            <EmptyState
              headline="Nothing to chart yet"
              hint="Finish a task or run the focus timer once — this page fills itself in from normal use. No extra tracking to remember."
            />
          </CardBody>
        </Card>
      ) : (
        <>
          {/* KPI row — this week at a glance */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Focus this week"
              value={fmtMins(data.kpis.focusMinutesWeek)}
              delta={
                data.kpis.focusMinutesLastWeek > 0 || focusDelta !== 0
                  ? {
                      text: `${focusDelta >= 0 ? "+" : "−"}${fmtMins(Math.abs(focusDelta))} vs this point last week`,
                      good: focusDelta >= 0,
                    }
                  : null
              }
            />
            <StatTile
              label="Tasks done"
              value={String(data.kpis.tasksDoneWeek)}
              sub="this week"
            />
            <StatTile
              label="On time"
              value={
                data.kpis.onTimeRate === null
                  ? "—"
                  : `${Math.round(data.kpis.onTimeRate * 100)}%`
              }
              sub={
                data.kpis.onTimeRate === null
                  ? "nothing due yet"
                  : "of what came due"
              }
            />
            <StatTile
              label="Habits"
              value={
                data.kpis.habitsTotal === 0
                  ? "—"
                  : `${data.kpis.habitsMet}/${data.kpis.habitsTotal}`
              }
              sub={
                data.kpis.habitsTotal === 0
                  ? "no habits yet"
                  : "weekly targets met"
              }
            />
          </div>

          <ScoreCard view={data.score} />

          {/* Focus timeline */}
          <Card>
            <CardHeader title="Focus — last 14 days" />
            <CardBody>
              <FocusTimeline data={data.timeline} />
              <NumbersTable
                caption="Focus minutes and tasks completed per day, last 14 days"
                head={["Day", "Focus", "Tasks done"]}
                rows={data.timeline.map((d) => [
                  monthDay(d.day),
                  fmtMins(d.minutes),
                  d.tasks,
                ])}
              />
            </CardBody>
          </Card>

          {/* Productive days heatmap */}
          <Card>
            <CardHeader title="Productive days — last 12 weeks" />
            <CardBody>
              <Heatmap cells={data.heatmap} />
            </CardBody>
          </Card>

          {/* Trends — small multiples, one measure per chart */}
          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <CardHeader title="Weekly focus trend" />
              <CardBody>
                <TrendLine
                  data={data.trends}
                  dataKey="focusMinutes"
                  unit="minutes"
                />
                <NumbersTable
                  caption="Focus minutes per week"
                  head={["Week of", "Focus"]}
                  rows={data.trends.map((t) => [
                    monthDay(t.weekOf),
                    fmtMins(t.focusMinutes),
                  ])}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Weekly completions trend" />
              <CardBody>
                <TrendLine
                  data={data.trends}
                  dataKey="tasksCompleted"
                  unit="tasks"
                />
                <NumbersTable
                  caption="Tasks completed per week"
                  head={["Week of", "Tasks done"]}
                  rows={data.trends.map((t) => [
                    monthDay(t.weekOf),
                    t.tasksCompleted,
                  ])}
                />
              </CardBody>
            </Card>
          </div>

          {/* Where the time went */}
          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <CardHeader title="Time by category — 30 days" />
              <CardBody>
                {data.categories30.length === 0 ? (
                  <EmptyState
                    headline="No tracked focus yet"
                    hint="Focus sessions linked to events land here by category."
                  />
                ) : (
                  <BarList
                    unit="minutes"
                    rows={data.categories30.map((c) => ({
                      name: c.name,
                      value: c.minutes,
                      color: c.color,
                    }))}
                  />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Course workload — 30 days" />
              <CardBody>
                {data.courses30.length === 0 ? (
                  <EmptyState
                    headline="No course time yet"
                    hint="Start the timer from a class event (or pick the course) and workload shows up here."
                  />
                ) : (
                  <BarList
                    unit="minutes"
                    rows={data.courses30.map((c) => ({
                      name: c.name,
                      value: c.minutes,
                      color: c.color,
                      hint: `${c.sessions} session${c.sessions === 1 ? "" : "s"}`,
                    }))}
                  />
                )}
              </CardBody>
            </Card>
          </div>

          {/* Session + free-time facts, semester progress */}
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              label="Average session"
              value={
                data.avgSessionMinutes30 === null
                  ? "—"
                  : fmtMins(data.avgSessionMinutes30)
              }
              sub="last 30 days"
            />
            <StatTile
              label="Free time"
              value={
                data.freeMinutesAvg7 === null
                  ? "—"
                  : `${fmtMins(data.freeMinutesAvg7)}/day`
              }
              sub="avg outside scheduled events, 8am–10pm"
            />
          </div>

          {data.semester ? (
            <Card>
              <CardHeader title="Semester" />
              <CardBody>
                <Meter
                  pct={data.semester.pct}
                  startLabel={monthDay(data.semester.startIso)}
                  endLabel={monthDay(data.semester.endIso)}
                />
                <p className="mt-2 text-xs text-ink-faint">
                  Estimated from the span of scheduled work on your calendar.
                </p>
              </CardBody>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
