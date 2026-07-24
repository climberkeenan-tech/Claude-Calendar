import Link from "next/link";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { CategoryDot } from "@/components/ui/badge";
import { fmtTime, relativeDue } from "@/lib/time";
import type { CalendarItem } from "@/lib/db/queries/calendar";
import type { DashboardData } from "@/lib/db/queries/dashboard";
import { CompleteButton } from "./complete-button";
import { HabitRow } from "./habit-row";
import { InboxRow } from "./inbox-row";

export function TodaySchedule({ items, now }: { items: CalendarItem[]; now: Date }) {
  return (
    <Card>
      <CardHeader title="Today's schedule" />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState headline="A clear day" hint="Anything you add with Q lands here." />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {items.map((e) => {
              const past = e.endsAt ? e.endsAt.getTime() < now.getTime() : false;
              return (
                <li
                  key={`${e.id}-${e.occurrenceDate ?? ""}`}
                  className={`flex items-center gap-3 rounded-(--radius-sm) px-2 py-2 ${past || e.completed ? "opacity-50" : ""}`}
                >
                  <span className="w-16 shrink-0 font-mono text-xs text-ink-muted">
                    {e.allDay ? "all day" : e.startsAt ? fmtTime(e.startsAt) : ""}
                  </span>
                  {e.categoryColor ? <CategoryDot color={e.categoryColor} /> : <span className="size-2.5" />}
                  <span className={`min-w-0 flex-1 truncate text-sm text-ink ${e.completed ? "line-through" : ""}`}>
                    {e.recurring ? "↻ " : ""}
                    {e.title}
                  </span>
                  {e.location ? (
                    <span className="hidden truncate text-xs text-ink-faint sm:block">{e.location}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function Deadlines({ items, now }: { items: CalendarItem[]; now: Date }) {
  return (
    <Card>
      <CardHeader title="Upcoming deadlines" />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState
            headline="No deadlines in the next two weeks"
            hint="Try “Essay due Friday” in quick add."
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {items.map((t) => {
              const overdue = t.dueAt ? t.dueAt.getTime() < now.getTime() : false;
              return (
                <li key={t.id} className="flex items-center gap-3 rounded-(--radius-sm) px-2 py-2">
                  <CompleteButton eventId={t.id} title={t.title} />
                  {t.categoryColor ? <CategoryDot color={t.categoryColor} /> : <span className="size-2.5" />}
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.title}</span>
                  <span className={`shrink-0 font-mono text-xs ${overdue ? "text-danger" : "text-ink-muted"}`}>
                    {t.dueAt ? relativeDue(now, t.dueAt) : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function InboxZone({ items }: { items: { id: string; title: string }[] }) {
  return (
    <Card>
      <CardHeader
        title={`Inbox${items.length ? ` (${items.length})` : ""}`}
        action={
          <Link href="/assignments" className="text-xs text-accent hover:underline">
            View all
          </Link>
        }
      />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState
            headline="Inbox zero"
            hint="Quick-add something without a date and it waits here — no forced decisions."
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {items.slice(0, 6).map((t) => (
              <InboxRow key={t.id} id={t.id} title={t.title} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function Habits({ habits, weekStartIso }: { habits: DashboardData["habits"]; weekStartIso: string }) {
  return (
    <Card>
      <CardHeader title="Habits this week" />
      <CardBody>
        {habits.length === 0 ? (
          <EmptyState
            headline="No habits yet"
            hint="Try “Gym every Monday at 5” in quick add — weekly targets, never guilt-streaks."
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {habits.map((h) => (
              <HabitRow key={h.id} habit={h} weekStartIso={weekStartIso} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function RecentActivity({ items }: { items: DashboardData["activity"] }) {
  const labels: Record<string, string> = {
    event_created: "Added",
    event_completed: "Completed",
    event_moved: "Moved",
    event_edited: "Edited",
    event_deleted: "Deleted",
    occurrence_completed: "Completed",
    occurrence_uncompleted: "Reopened",
    captured_to_inbox: "Captured",
    task_scheduled: "Scheduled",
  };
  return (
    <Card>
      <CardHeader title="Recent activity" />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState headline="Quiet so far" hint="Actions you take show up here." />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {items.map((a) => (
              <li key={a.id} className="flex items-baseline gap-2 rounded-(--radius-sm) px-2 py-1.5">
                <span className="text-xs text-ink-faint">{labels[a.type] ?? a.type}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">
                  {typeof a.data?.title === "string" ? a.data.title : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
