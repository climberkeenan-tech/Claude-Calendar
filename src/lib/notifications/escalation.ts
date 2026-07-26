/**
 * Escalation v1 (ARCHITECTURE §7): when reminders for a deadline keep being
 * ignored and the deadline is inside the danger window, add a small number
 * of tighter, flagged reminders. Hard caps + quiet-hour respect (via the
 * normal delivery path) so it motivates rather than harasses.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { events, notificationJobs, userSettings } from "@/lib/db/schema";
import { scheduleCallback } from "./qstash";

const DANGER_WINDOW_MS = 24 * 3600_000;
const IGNORED_THRESHOLD = 2; // sent-and-unacknowledged firings
const MAX_ESCALATIONS_PER_ITEM = 2;

export async function runEscalationForUser(userId: string): Promise<number> {
  const [settings] = await db
    .select({ enabled: userSettings.escalationEnabled })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  if (settings && !settings.enabled) return 0;

  const now = new Date();
  const dangerEnd = new Date(now.getTime() + DANGER_WINDOW_MS);

  // Open tasks due inside the danger window.
  const atRisk = await db
    .select({ id: events.id, dueAt: events.dueAt, title: events.title })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.kind, "task"),
        eq(events.status, "scheduled"),
        gte(events.dueAt, now),
        sql`${events.dueAt} <= ${dangerEnd}`,
      ),
    );

  let created = 0;
  for (const task of atRisk) {
    if (!task.dueAt) continue;
    const jobs = await db
      .select({
        status: notificationJobs.status,
        isEscalation: notificationJobs.isEscalation,
        sendAt: notificationJobs.sendAt,
        reminderId: notificationJobs.reminderId,
        occurrenceAt: notificationJobs.occurrenceAt,
      })
      .from(notificationJobs)
      .where(eq(notificationJobs.eventId, task.id));

    // Count FIRINGS, not rows. Every reminder fans out to at least two rows
    // (channelsFor always adds an in_app companion alongside push/email), so
    // counting rows tripped the threshold after a single ignored reminder —
    // escalating twice as eagerly as the policy says, which is the opposite of
    // the gentle default this phase was built around.
    const ignored = new Set(
      jobs
        .filter((j) => j.status === "sent" && j.isEscalation === false)
        .map((j) => `${j.reminderId}|${j.occurrenceAt.toISOString()}`),
    ).size;
    if (ignored < IGNORED_THRESHOLD) continue;

    const existingEscalations = jobs.filter((j) => j.isEscalation).length;
    if (existingEscalations >= MAX_ESCALATIONS_PER_ITEM) continue;

    // Tighter checkpoints: 3 h and 1 h before the deadline (whichever are
    // still in the future and not already covered).
    const checkpoints = [3 * 3600_000, 1 * 3600_000]
      .map((offset) => new Date(task.dueAt!.getTime() - offset))
      .filter((t) => t.getTime() > now.getTime() + 5 * 60_000)
      .filter(
        (t) =>
          !jobs.some((j) => Math.abs(j.sendAt.getTime() - t.getTime()) < 15 * 60_000),
      )
      .slice(0, MAX_ESCALATIONS_PER_ITEM - existingEscalations);

    for (const sendAt of checkpoints) {
      const id = crypto.randomUUID();
      const qstashMessageId = await scheduleCallback(
        { jobId: id, phase: "deliver" },
        sendAt,
      );
      await db.insert(notificationJobs).values({
        id,
        reminderId: null,
        eventId: task.id,
        occurrenceAt: task.dueAt,
        sendAt,
        channel: "push",
        isEscalation: true,
        qstashMessageId,
      });
      created++;
    }
  }
  return created;
}
