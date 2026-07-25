import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { categories, events } from "@/lib/db/schema";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { CategoryDot } from "@/components/ui/badge";
import { CompleteButton } from "@/components/dashboard/complete-button";
import { InboxRow } from "@/components/dashboard/inbox-row";
import { relativeDue } from "@/lib/time";
import { sortByPriority } from "@/lib/analytics/priority";
import { TriageChips } from "@/components/plan/triage-row";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assignments" };

export default async function AssignmentsPage() {
  const userId = await requireUserId();
  const now = new Date();
  const base = and(
    eq(events.userId, userId),
    eq(events.kind, "task"),
    eq(events.status, "scheduled"),
  );
  const [datedRaw, inbox] = await Promise.all([
    db
      .select({
        id: events.id,
        title: events.title,
        dueAt: events.dueAt,
        priority: events.priority,
        estimatedMinutes: events.estimatedMinutes,
        categoryName: categories.name,
        categoryColor: categories.color,
      })
      .from(events)
      .leftJoin(categories, eq(events.categoryId, categories.id))
      .where(and(base, isNotNull(events.dueAt)))
      .orderBy(asc(events.dueAt)),
    db
      .select({ id: events.id, title: events.title })
      .from(events)
      .where(and(base, isNull(events.dueAt)))
      .orderBy(asc(events.createdAt)),
  ]);
  // Auto-prioritization: deadline pressure + priority + stakes, not just
  // due-date order (Phase 6). Deterministic and explainable.
  const dated = sortByPriority(datedRaw, now);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="font-display text-2xl text-ink">Assignments</h1>

      {inbox.length > 0 ? (
        <Card>
          <CardHeader title={`Inbox (${inbox.length})`} />
          <CardBody>
            <p className="mb-2 text-xs text-ink-faint">
              Captured without a date — give each one a date whenever you&apos;re ready.
            </p>
            <ul className="flex flex-col divide-y divide-border">
              {inbox.map((t) => (
                <InboxRow key={t.id} id={t.id} title={t.title} />
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={`Open (${dated.length})`} />
        <CardBody>
          {dated.length === 0 ? (
            <EmptyState
              headline="Nothing with a deadline"
              hint="Press Q and try “Bio essay due Friday.”"
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {dated.map((t) => {
                const overdue = t.dueAt !== null && t.dueAt.getTime() < now.getTime();
                return (
                  <li key={t.id} className="flex flex-col gap-1.5 py-2.5">
                    <div className="flex items-center gap-3">
                      <CompleteButton eventId={t.id} title={t.title} />
                      {t.categoryColor ? (
                        <CategoryDot color={t.categoryColor} />
                      ) : (
                        <span className="size-2.5" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">
                        {t.title}
                      </span>
                      <span
                        className={`shrink-0 font-mono text-xs ${overdue ? "text-danger" : "text-ink-muted"}`}
                      >
                        {t.dueAt ? relativeDue(now, t.dueAt) : ""}
                      </span>
                    </div>
                    {/* Gentle triage: it slipped, that's fine — what now? */}
                    {overdue ? (
                      <div className="pl-8">
                        <TriageChips taskId={t.id} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
