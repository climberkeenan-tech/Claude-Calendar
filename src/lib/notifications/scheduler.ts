/**
 * DB side of the notification pipeline: materialize `notification_jobs` from
 * reminder intents, keep QStash alarms in sync, deliver, and sweep.
 */
import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  events,
  notificationJobs,
  occurrences,
  reminders,
  users,
  userSettings,
} from "@/lib/db/schema";
import {
  desiredJobs,
  diffJobs,
  quietHoursDeferral,
  ENQUEUE_WINDOW_MS,
  LEASE_MS,
  PUSH_FALLBACK_AFTER_MS,
  STALE_AFTER_MS,
} from "./policy";
import { dispatch } from "./channels";
import { cancelCallback, scheduleCallback } from "./qstash";
import { isoDayInTz } from "@/lib/tz";

/**
 * Re-derive the job set for one event after any change (create, edit, move,
 * complete, reminder change). Cancels stale alarms, creates missing jobs,
 * and sets alarms for anything due inside the QStash window.
 */
export async function syncJobsForEvent(eventId: string): Promise<void> {
  const eventRows = await db.select().from(events).where(eq(events.id, eventId));
  if (eventRows.length === 0) return;
  const event = eventRows[0];

  const [reminderRows, overrideRows, existing] = await Promise.all([
    db.select().from(reminders).where(eq(reminders.eventId, eventId)),
    db.select().from(occurrences).where(eq(occurrences.eventId, eventId)),
    // Escalation jobs have no reminder row behind them, so the diff would
    // never find a desired counterpart and would cancel every one of them on
    // the next edit. They're owned entirely by escalation.ts; deliverJob
    // still re-checks staleness when they fire.
    db
      .select()
      .from(notificationJobs)
      .where(
        and(
          eq(notificationJobs.eventId, eventId),
          eq(notificationJobs.isEscalation, false),
        ),
      ),
  ]);

  const now = new Date();
  const desired = desiredJobs(
    {
      id: event.id,
      kind: event.kind,
      status: event.status,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      dueAt: event.dueAt,
      rrule: event.rrule,
      tz: event.tz,
    },
    reminderRows.map((r) => ({
      id: r.id,
      offsetMinutes: r.offsetMinutes,
      absoluteAt: r.absoluteAt,
      channels: r.channels,
      enabled: r.enabled,
    })),
    overrideRows.map((o) => ({
      occurrenceDate: o.occurrenceDate,
      cancelled: o.cancelled,
      completed: o.completed,
      overrides: o.overrides,
    })),
    now,
  );

  const { create, cancel } = diffJobs(
    desired,
    existing.map((e) => ({
      id: e.id,
      reminderId: e.reminderId,
      occurrenceAt: e.occurrenceAt,
      sendAt: e.sendAt,
      channel: e.channel,
      status: e.status,
    })),
    now,
  );

  for (const c of cancel) {
    const row = existing.find((e) => e.id === c.id)!;
    if (row.qstashMessageId) await cancelCallback(row.qstashMessageId);
    await db
      .update(notificationJobs)
      .set({ status: "cancelled" })
      .where(eq(notificationJobs.id, c.id));
  }

  for (const d of create) {
    const id = crypto.randomUUID();
    let qstashMessageId: string | null = null;
    if (d.sendAt.getTime() <= now.getTime() + ENQUEUE_WINDOW_MS) {
      qstashMessageId = await scheduleCallback({ jobId: id, phase: "deliver" }, d.sendAt);
    }
    await db.insert(notificationJobs).values({
      id,
      reminderId: d.reminderId,
      eventId,
      occurrenceAt: d.occurrenceAt,
      sendAt: d.sendAt,
      channel: d.channel,
      qstashMessageId,
    });
  }
}

/** Mark this event's fired-but-unacknowledged notifications as read — called
 * when the user completes the item (completing IS acknowledging). */
export async function acknowledgeJobsForEvent(eventId: string): Promise<void> {
  await db
    .update(notificationJobs)
    .set({ status: "acknowledged", ackedAt: new Date() })
    .where(
      and(eq(notificationJobs.eventId, eventId), eq(notificationJobs.status, "sent")),
    );
}

export type DeliverOutcome =
  | "delivered"
  | "skipped"
  | "deferred"
  | "failed"
  | "not_found";

/**
 * Deliver one job — idempotent and crash-safe:
 *   pending → (lease) sending → sent on provider accept.
 * Re-checks event state at delivery time; quiet hours defer, never drop.
 */
export async function deliverJob(jobId: string): Promise<DeliverOutcome> {
  const rows = await db
    .select()
    .from(notificationJobs)
    .where(eq(notificationJobs.id, jobId));
  if (rows.length === 0) return "not_found";
  const job = rows[0];

  const now = new Date();
  const leaseOk =
    job.status === "pending" ||
    job.status === "deferred" ||
    (job.status === "sending" &&
      job.leaseExpiresAt !== null &&
      job.leaseExpiresAt.getTime() < now.getTime());
  if (!leaseOk) return "skipped";

  // Load event + owner; re-check everything that can make this reminder stale.
  const eventRows = await db
    .select({
      id: events.id,
      userId: events.userId,
      title: events.title,
      kind: events.kind,
      status: events.status,
      location: events.location,
      tz: events.tz,
      rrule: events.rrule,
      startsAt: events.startsAt,
      dueAt: events.dueAt,
    })
    .from(events)
    .where(eq(events.id, job.eventId));
  if (eventRows.length === 0) {
    await db
      .update(notificationJobs)
      .set({ status: "cancelled" })
      .where(eq(notificationJobs.id, jobId));
    return "skipped";
  }
  const event = eventRows[0];
  if (event.status !== "scheduled") {
    await db
      .update(notificationJobs)
      .set({ status: "cancelled" })
      .where(eq(notificationJobs.id, jobId));
    return "skipped";
  }
  // The item moved since this job was materialized (its anchor no longer
  // matches). Overdue jobs now survive re-syncs so the daily sweep can
  // deliver them — this is what stops a swept job from announcing a time
  // that no longer exists.
  if (!event.rrule) {
    const anchor = event.kind === "task" ? event.dueAt : event.startsAt;
    if (!anchor || Math.abs(anchor.getTime() - job.occurrenceAt.getTime()) > 60_000) {
      await db
        .update(notificationJobs)
        .set({ status: "cancelled" })
        .where(eq(notificationJobs.id, jobId));
      return "skipped";
    }
  }

  if (event.rrule) {
    // Occurrence rows are keyed by the date in the EVENT's timezone. Using
    // the UTC date silently missed every evening occurrence (8 PM ET is
    // already tomorrow in UTC), so cancelled/completed evening classes still
    // got reminders.
    const occIso = isoDayInTz(job.occurrenceAt, event.tz);
    const occ = await db
      .select()
      .from(occurrences)
      .where(
        and(eq(occurrences.eventId, event.id), eq(occurrences.occurrenceDate, occIso)),
      );
    if (occ.length > 0 && (occ[0].cancelled || occ[0].completed)) {
      await db
        .update(notificationJobs)
        .set({ status: "cancelled" })
        .where(eq(notificationJobs.id, jobId));
      return "skipped";
    }
  }

  const [owner] = await db
    .select({ email: users.email, tz: users.timezone })
    .from(users)
    .where(eq(users.id, event.userId));
  const [settings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, event.userId));

  // Channel preference re-check (user may have turned a channel off).
  const prefs = settings?.channelPrefs;
  if (prefs) {
    const prefKey = { in_app: "inApp", push: "push", email: "email", sms: "sms" }[
      job.channel
    ] as keyof typeof prefs | undefined;
    if (prefKey && prefs[prefKey] === false) {
      await db
        .update(notificationJobs)
        .set({ status: "cancelled" })
        .where(eq(notificationJobs.id, jobId));
      return "skipped";
    }
  }

  // Quiet hours: defer, never drop (in-app rows are silent — always allowed).
  if (job.channel !== "in_app" && settings) {
    const deferUntil = quietHoursDeferral(
      now,
      { start: settings.quietHoursStart, end: settings.quietHoursEnd },
      owner?.tz ?? event.tz,
    );
    if (deferUntil) {
      const qstashMessageId = await scheduleCallback(
        { jobId, phase: "deliver" },
        deferUntil,
      );
      await db
        .update(notificationJobs)
        .set({ status: "deferred", sendAt: deferUntil, qstashMessageId })
        .where(eq(notificationJobs.id, jobId));
      return "deferred";
    }
  }

  // Take the lease.
  await db
    .update(notificationJobs)
    .set({
      status: "sending",
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      attempts: job.attempts + 1,
    })
    .where(eq(notificationJobs.id, jobId));

  const result = await dispatch(job.channel, {
    jobId,
    userId: event.userId,
    userEmail: owner?.email ?? "",
    title: event.title,
    kind: event.kind,
    occurrenceAt: job.occurrenceAt,
    location: event.location,
  });

  if (result.ok) {
    await db
      .update(notificationJobs)
      .set({ status: "sent", sentAt: new Date(), leaseExpiresAt: null })
      .where(eq(notificationJobs.id, jobId));
    // Reliability net: an unacknowledged push falls back to email.
    if (job.channel === "push") {
      await scheduleCallback(
        { jobId, phase: "fallback" },
        new Date(Date.now() + PUSH_FALLBACK_AFTER_MS),
      );
    }
    return "delivered";
  }

  await db
    .update(notificationJobs)
    .set({
      status: job.attempts + 1 >= 5 ? "failed" : "pending",
      leaseExpiresAt: null,
    })
    .where(eq(notificationJobs.id, jobId));
  return "failed";
}

/** Push went out but nobody reacted → send the email that can't be missed. */
export async function pushFallback(jobId: string): Promise<DeliverOutcome> {
  const rows = await db
    .select()
    .from(notificationJobs)
    .where(eq(notificationJobs.id, jobId));
  if (rows.length === 0) return "not_found";
  const job = rows[0];
  if (job.status !== "sent" || job.ackedAt !== null || job.channel !== "push") {
    return "skipped";
  }
  const eventRows = await db
    .select({
      id: events.id,
      userId: events.userId,
      title: events.title,
      kind: events.kind,
      status: events.status,
      location: events.location,
    })
    .from(events)
    .where(eq(events.id, job.eventId));
  if (eventRows.length === 0 || eventRows[0].status !== "scheduled") return "skipped";
  const event = eventRows[0];
  const [owner] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, event.userId));
  const [settings] = await db
    .select({ prefs: userSettings.channelPrefs })
    .from(userSettings)
    .where(eq(userSettings.userId, event.userId));
  if (settings?.prefs && settings.prefs.email === false) return "skipped";

  const result = await dispatch("email", {
    jobId: `${jobId}-fallback`,
    userId: event.userId,
    userEmail: owner?.email ?? "",
    title: event.title,
    kind: event.kind,
    occurrenceAt: job.occurrenceAt,
    location: event.location,
  });
  return result.ok ? "delivered" : "failed";
}

/**
 * Daily maintenance (Vercel cron is daily-only on Hobby — precision lives in
 * QStash; this is the horizon-top-up + safety net):
 *  1. re-materialize jobs for every event with reminders (60-day horizon)
 *  2. set alarms for jobs entering the 48 h window
 *  3. deliver anything that slipped past its send time or has a dead lease
 */
export async function dailyMaintenance(): Promise<{
  synced: number;
  enqueued: number;
  swept: number;
}> {
  const now = new Date();

  // Sweep FIRST: anything that slipped past its send time gets its chance
  // before the re-sync touches the job set. (diffJobs also protects overdue
  // and deferred jobs now — this ordering is belt and braces.)
  //
  // Bounded at both ends. Without the lower bound the sweep would deliver
  // jobs overdue by weeks, contradicting STALE_AFTER_MS: "a job overdue by
  // more than this is past saving — delivering it would be noise, not a
  // safety net." Waking someone at 2 AM about a deadline from last Tuesday is
  // exactly the behaviour that gets notifications turned off for good.
  const staleFloor = new Date(now.getTime() - STALE_AFTER_MS);
  const overdueFirst = await db
    .select({ id: notificationJobs.id })
    .from(notificationJobs)
    .where(
      or(
        and(
          inArray(notificationJobs.status, ["pending", "deferred"]),
          lt(notificationJobs.sendAt, new Date(now.getTime() - 5 * 60 * 1000)),
          gte(notificationJobs.sendAt, staleFloor),
        ),
        and(
          eq(notificationJobs.status, "sending"),
          lt(notificationJobs.leaseExpiresAt, now),
        ),
      ),
    );
  let swept = 0;
  for (const j of overdueFirst) {
    const outcome = await deliverJob(j.id);
    if (outcome === "delivered") swept++;
  }

  const eventIds = await db
    .selectDistinct({ eventId: reminders.eventId })
    .from(reminders)
    .innerJoin(events, eq(reminders.eventId, events.id))
    .where(eq(events.status, "scheduled"));
  for (const { eventId } of eventIds) {
    await syncJobsForEvent(eventId);
  }

  // Alarms for jobs that just entered the window (syncJobsForEvent covers new
  // jobs; this catches pre-existing rows created outside the window).
  const needingAlarm = await db
    .select({ id: notificationJobs.id, sendAt: notificationJobs.sendAt })
    .from(notificationJobs)
    .where(
      and(
        eq(notificationJobs.status, "pending"),
        isNull(notificationJobs.qstashMessageId),
        lte(notificationJobs.sendAt, new Date(now.getTime() + ENQUEUE_WINDOW_MS)),
        sql`${notificationJobs.sendAt} > ${now}`,
      ),
    );
  for (const j of needingAlarm) {
    const messageId = await scheduleCallback({ jobId: j.id, phase: "deliver" }, j.sendAt);
    if (messageId) {
      await db
        .update(notificationJobs)
        .set({ qstashMessageId: messageId })
        .where(eq(notificationJobs.id, j.id));
    }
  }

  return { synced: eventIds.length, enqueued: needingAlarm.length, swept };
}
