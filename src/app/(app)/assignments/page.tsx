import { and, asc, eq } from "drizzle-orm";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { categories, events } from "@/lib/db/schema";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { CategoryDot } from "@/components/ui/badge";
import { CompleteButton } from "@/components/dashboard/complete-button";
import { relativeDue } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assignments" };

export default async function AssignmentsPage() {
  const userId = await requireUserId();
  const now = new Date();
  const open = await db
    .select({
      id: events.id,
      title: events.title,
      dueAt: events.dueAt,
      categoryName: categories.name,
      categoryColor: categories.color,
    })
    .from(events)
    .leftJoin(categories, eq(events.categoryId, categories.id))
    .where(
      and(
        eq(events.userId, userId),
        eq(events.kind, "task"),
        eq(events.status, "scheduled"),
      ),
    )
    .orderBy(asc(events.dueAt));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="font-display text-2xl text-ink">Assignments</h1>
      <Card>
        <CardHeader title={`Open (${open.length})`} />
        <CardBody>
          {open.length === 0 ? (
            <EmptyState
              headline="Nothing open"
              hint="Press Q anywhere and choose “Task with deadline.”"
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {open.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2.5">
                  <CompleteButton eventId={t.id} title={t.title} />
                  {t.categoryColor ? (
                    <CategoryDot color={t.categoryColor} />
                  ) : (
                    <span className="size-2.5" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {t.title}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-ink-muted">
                    {t.dueAt ? relativeDue(now, t.dueAt) : "no due date"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
