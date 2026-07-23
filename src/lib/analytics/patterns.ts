/**
 * user_patterns derivation — the "gets smarter over time" mechanism is
 * transparent, recomputed-nightly data injected into AI prompts, never
 * hidden model state (ARCHITECTURE §9).
 */
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  courses,
  events,
  focusSessions,
  notificationJobs,
  userPatterns,
} from "@/lib/db/schema";

export type UserPatterns = {
  computedAt: string;
  /** actualMinutes / estimatedMinutes per category — >1 means underestimating */
  estimateAccuracy: Record<string, { ratio: number; samples: number }>;
  /** Completions by local hour (0-23) over the last 60 days */
  completionByHour: number[];
  /** Focus minutes by local hour */
  focusByHour: number[];
  /** sent vs acknowledged reminder counts */
  reminders: { sent: number; acknowledged: number; ignoreRate: number };
  /** items completed after their due date, last 30 days */
  lateCompletions: number;
  /** open tasks postponed (due date moved) in activity — proxy: reschedules */
  totalOpenTasks: number;
};

export async function derivePatterns(userId: string): Promise<UserPatterns> {
  const since60 = new Date(Date.now() - 60 * 24 * 3600_000);
  const since30 = new Date(Date.now() - 30 * 24 * 3600_000);

  const [withEstimates, completions, focus, jobs, late, openTasks] =
    await Promise.all([
      db
        .select({
          category: sql<string>`coalesce(${courses.name}, 'General')`,
          estimated: events.estimatedMinutes,
          actual: events.actualMinutes,
        })
        .from(events)
        .leftJoin(courses, eq(events.courseId, courses.id))
        .where(
          and(
            eq(events.userId, userId),
            isNotNull(events.estimatedMinutes),
            isNotNull(events.actualMinutes),
            gte(events.updatedAt, since60),
          ),
        ),
      db
        .select({
          hour: sql<number>`extract(hour from ${events.completedAt} at time zone 'America/New_York')::int`,
          n: sql<number>`count(*)::int`,
        })
        .from(events)
        .where(
          and(
            eq(events.userId, userId),
            isNotNull(events.completedAt),
            gte(events.completedAt, since60),
          ),
        )
        .groupBy(sql`1`),
      db
        .select({
          hour: sql<number>`extract(hour from ${focusSessions.startedAt} at time zone 'America/New_York')::int`,
          minutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}), 0)::int`,
        })
        .from(focusSessions)
        .where(
          and(eq(focusSessions.userId, userId), gte(focusSessions.startedAt, since60)),
        )
        .groupBy(sql`1`),
      db
        .select({
          status: notificationJobs.status,
          n: sql<number>`count(*)::int`,
        })
        .from(notificationJobs)
        .innerJoin(events, eq(notificationJobs.eventId, events.id))
        .where(
          and(
            eq(events.userId, userId),
            gte(notificationJobs.sendAt, since30),
            sql`${notificationJobs.status} in ('sent', 'acknowledged')`,
          ),
        )
        .groupBy(notificationJobs.status),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(events)
        .where(
          and(
            eq(events.userId, userId),
            eq(events.kind, "task"),
            isNotNull(events.completedAt),
            isNotNull(events.dueAt),
            gte(events.completedAt, since30),
            sql`${events.completedAt} > ${events.dueAt}`,
          ),
        ),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(events)
        .where(
          and(
            eq(events.userId, userId),
            eq(events.kind, "task"),
            eq(events.status, "scheduled"),
          ),
        ),
    ]);

  const estimateAccuracy: UserPatterns["estimateAccuracy"] = {};
  const grouped = new Map<string, number[]>();
  for (const row of withEstimates) {
    if (!row.estimated || !row.actual) continue;
    const list = grouped.get(row.category) ?? [];
    list.push(row.actual / row.estimated);
    grouped.set(row.category, list);
  }
  for (const [cat, ratios] of grouped) {
    estimateAccuracy[cat] = {
      ratio: Number((ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(2)),
      samples: ratios.length,
    };
  }

  const completionByHour = Array.from({ length: 24 }, () => 0);
  for (const r of completions) completionByHour[r.hour] = r.n;
  const focusByHour = Array.from({ length: 24 }, () => 0);
  for (const r of focus) focusByHour[r.hour] = r.minutes;

  const sent = jobs.find((j) => j.status === "sent")?.n ?? 0;
  const acknowledged = jobs.find((j) => j.status === "acknowledged")?.n ?? 0;
  const total = sent + acknowledged;

  const patterns: UserPatterns = {
    computedAt: new Date().toISOString(),
    estimateAccuracy,
    completionByHour,
    focusByHour,
    reminders: {
      sent: total,
      acknowledged,
      ignoreRate: total > 0 ? Number((sent / total).toFixed(2)) : 0,
    },
    lateCompletions: late[0]?.n ?? 0,
    totalOpenTasks: openTasks[0]?.n ?? 0,
  };

  await db
    .insert(userPatterns)
    .values({ userId, patterns, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userPatterns.userId,
      set: { patterns, updatedAt: new Date() },
    });

  return patterns;
}
