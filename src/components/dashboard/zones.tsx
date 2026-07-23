import Link from "next/link";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { CategoryDot } from "@/components/ui/badge";
import { fmtTime, relativeDue } from "@/lib/time";
import type { DashboardData, DashboardEvent } from "@/lib/db/queries/dashboard";
import { CompleteButton } from "./complete-button";

export function TodaySchedule({ items, now }: { items: DashboardEvent[]; now: Date }) {
  return (
    <Card>
      <CardHeader title="Today's schedule" />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState
            headline="A clear day"
            hint="Anything you add with Q lands here."
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {items.map((e) => {
              const past = e.endsAt ? e.endsAt.getTime() < now.getTime() : false;
              return (
                <li
                  key={e.id}
                  className={`flex items-center gap-3 rounded-(--radius-sm) px-2 py-2 ${past ? "opacity-50" : ""}`}
                >
                  <span className="w-16 shrink-0 font-mono text-xs text-ink-muted">
                    {e.allDay ? "all day" : e.startsAt ? fmtTime(e.startsAt) : ""}
                  </span>
                  {e.categoryColor ? <CategoryDot color={e.categoryColor} /> : <span className="size-2.5" />}
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{e.title}</span>
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

export function Deadlines({ items, now }: { items: DashboardEvent[]; now: Date }) {
  return (
    <Card>
      <CardHeader title="Upcoming deadlines" />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState
            headline="No deadlines in the next two weeks"
            hint="Add assignments with Q — pick “Task with deadline.”"
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
                  <span
                    className={`shrink-0 font-mono text-xs ${overdue ? "text-danger" : "text-ink-muted"}`}
                  >
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

export function Assignments({ items }: { items: DashboardEvent[] }) {
  return (
    <Card>
      <CardHeader
        title="Assignments"
        action={
          <Link href="/assignments" className="text-xs text-accent hover:underline">
            View all
          </Link>
        }
      />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState
            headline="Nothing open"
            hint="Open tasks across all courses will collect here."
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {items.slice(0, 6).map((t) => (
              <li key={t.id} className="flex items-center gap-3 rounded-(--radius-sm) px-2 py-2">
                <CompleteButton eventId={t.id} title={t.title} />
                {t.categoryColor ? <CategoryDot color={t.categoryColor} /> : <span className="size-2.5" />}
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.title}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function Habits() {
  return (
    <Card>
      <CardHeader title="Habits" />
      <CardBody>
        <EmptyState
          headline="Habit tracking arrives in Phase 3"
          hint="Weekly targets — “3 of 7 days” — with backfill, never guilt-streaks."
        />
      </CardBody>
    </Card>
  );
}

export function StudyTimer() {
  return (
    <Card>
      <CardHeader title="Study timer" />
      <CardBody>
        <EmptyState
          headline="The focus timer arrives in Phase 4"
          hint="Sessions will feed the analytics you'll see in Phase 8."
        />
      </CardBody>
    </Card>
  );
}

export function ProductivityScore() {
  return (
    <Card>
      <CardHeader title="This week" />
      <CardBody>
        <EmptyState
          headline="Your weekly summary arrives in Phase 8"
          hint="Wins first, one suggested next action — and it's hideable."
        />
      </CardBody>
    </Card>
  );
}

export function RecentActivity({ items }: { items: DashboardData["activity"] }) {
  const labels: Record<string, string> = {
    event_created: "Added",
    event_completed: "Completed",
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
                <span className="text-xs text-ink-faint">
                  {labels[a.type] ?? a.type}
                </span>
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
