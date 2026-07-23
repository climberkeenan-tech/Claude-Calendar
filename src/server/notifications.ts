"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  categories,
  events,
  notificationJobs,
  pushSubscriptions,
  userSettings,
} from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";
import { scheduleCallback } from "@/lib/notifications/qstash";
import { dispatch } from "@/lib/notifications/channels";
import { auth } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Bell feed
// ---------------------------------------------------------------------------

export type BellItem = {
  jobId: string;
  eventId: string;
  title: string;
  kind: "event" | "task" | "habit";
  occurrenceAt: Date;
  sentAt: Date | null;
  categoryName: string | null;
};

export async function getBellFeed(): Promise<BellItem[]> {
  const userId = await requireUserId();
  return db
    .select({
      jobId: notificationJobs.id,
      eventId: events.id,
      title: events.title,
      kind: events.kind,
      occurrenceAt: notificationJobs.occurrenceAt,
      sentAt: notificationJobs.sentAt,
      categoryName: categories.name,
    })
    .from(notificationJobs)
    .innerJoin(events, eq(notificationJobs.eventId, events.id))
    .leftJoin(categories, eq(events.categoryId, categories.id))
    .where(
      and(
        eq(events.userId, userId),
        eq(notificationJobs.channel, "in_app"),
        eq(notificationJobs.status, "sent"),
      ),
    )
    .orderBy(desc(notificationJobs.sentAt))
    .limit(20);
}

async function ownedJob(userId: string, jobId: string) {
  const rows = await db
    .select({
      id: notificationJobs.id,
      eventId: notificationJobs.eventId,
      reminderId: notificationJobs.reminderId,
      occurrenceAt: notificationJobs.occurrenceAt,
      channel: notificationJobs.channel,
      status: notificationJobs.status,
    })
    .from(notificationJobs)
    .innerJoin(events, eq(notificationJobs.eventId, events.id))
    .where(and(eq(notificationJobs.id, jobId), eq(events.userId, userId)));
  if (rows.length === 0) throw new Error("Notification not found");
  return rows[0];
}

export async function acknowledgeJob(jobId: string): Promise<void> {
  const userId = await requireUserId();
  const job = await ownedJob(userId, jobId);
  // Acknowledging one surface acknowledges the whole firing (the push job and
  // its in-app record fired together for the same reminder+occurrence).
  const siblings = await db
    .select({ id: notificationJobs.id })
    .from(notificationJobs)
    .where(
      and(
        job.reminderId
          ? eq(notificationJobs.reminderId, job.reminderId)
          : eq(notificationJobs.id, jobId),
        eq(notificationJobs.occurrenceAt, job.occurrenceAt),
        eq(notificationJobs.status, "sent"),
      ),
    );
  await db
    .update(notificationJobs)
    .set({ status: "acknowledged", ackedAt: new Date() })
    .where(
      inArray(
        notificationJobs.id,
        siblings.map((s) => s.id),
      ),
    );
  revalidatePath("/");
}

export async function acknowledgeAll(): Promise<void> {
  const userId = await requireUserId();
  await db
    .update(notificationJobs)
    .set({ status: "acknowledged", ackedAt: new Date() })
    .where(
      and(
        eq(notificationJobs.status, "sent"),
        inArray(
          notificationJobs.eventId,
          db
            .select({ id: events.id })
            .from(events)
            .where(eq(events.userId, userId)),
        ),
      ),
    );
  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// Snooze — "again in 30 min · tonight · tomorrow"
// ---------------------------------------------------------------------------

const snoozeSchema = z.object({
  jobId: z.string(),
  until: z.enum(["30m", "tonight", "tomorrow"]),
});

export async function snoozeJob(input: z.infer<typeof snoozeSchema>): Promise<void> {
  const userId = await requireUserId();
  const v = snoozeSchema.parse(input);
  const job = await ownedJob(userId, v.jobId);

  const now = new Date();
  let sendAt: Date;
  if (v.until === "30m") {
    sendAt = new Date(now.getTime() + 30 * 60 * 1000);
  } else {
    // Tonight = 7 PM today; tomorrow = 9 AM next day (Eastern wall clock).
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
    const todayIso = fmt.format(now);
    const target =
      v.until === "tonight"
        ? `${todayIso}T19:00`
        : `${fmt.format(new Date(now.getTime() + 24 * 60 * 60 * 1000))}T09:00`;
    const { wallClockToInstant } = await import("@/lib/tz");
    sendAt = wallClockToInstant(target.slice(0, 10), target.slice(11), "America/New_York");
    if (sendAt.getTime() <= now.getTime()) {
      sendAt = new Date(now.getTime() + 60 * 60 * 1000); // "tonight" already passed
    }
  }

  await acknowledgeJob(v.jobId);
  const id = crypto.randomUUID();
  const qstashMessageId = await scheduleCallback({ jobId: id, phase: "deliver" }, sendAt);
  await db.insert(notificationJobs).values({
    id,
    reminderId: job.reminderId,
    eventId: job.eventId,
    occurrenceAt: job.occurrenceAt,
    sendAt,
    channel: "push",
    qstashMessageId,
  });
  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// "Too much — back off": thin this category's defaults to one reminder
// ---------------------------------------------------------------------------

export async function backOffCategory(eventId: string): Promise<string> {
  const userId = await requireUserId();
  const rows = await db
    .select({ categoryName: categories.name })
    .from(events)
    .leftJoin(categories, eq(events.categoryId, categories.id))
    .where(and(eq(events.id, eventId), eq(events.userId, userId)));
  const categoryName = rows[0]?.categoryName;
  if (!categoryName) return "This item has no category to adjust.";

  const [settings] = await db
    .select({ defaults: userSettings.defaultReminders })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  const current = settings?.defaults?.[categoryName] ?? [];
  if (current.length <= 1) {
    return `${categoryName} is already at its minimum (one reminder).`;
  }
  // Keep the SHORTEST offset — the one closest to the moment it matters.
  const kept = Math.min(...current);
  await db
    .update(userSettings)
    .set({
      defaultReminders: sql`jsonb_set(${userSettings.defaultReminders}, ${`{${categoryName}}`}, ${JSON.stringify([kept])}::jsonb)`,
    })
    .where(eq(userSettings.userId, userId));
  revalidatePath("/settings");
  return `New ${categoryName} items will get one reminder instead of ${current.length}. Existing items are unchanged.`;
}

// ---------------------------------------------------------------------------
// Push subscriptions
// ---------------------------------------------------------------------------

const subSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

export async function savePushSubscription(
  input: z.infer<typeof subSchema>,
  userAgent: string | null,
): Promise<void> {
  const userId = await requireUserId();
  const v = subSchema.parse(input);
  await db
    .insert(pushSubscriptions)
    .values({
      id: crypto.randomUUID(),
      userId,
      endpoint: v.endpoint,
      keys: v.keys,
      userAgent,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { keys: v.keys, userAgent },
    });
  revalidatePath("/settings");
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  const userId = await requireUserId();
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    );
  revalidatePath("/settings");
}

export async function countPushSubscriptions(): Promise<number> {
  const userId = await requireUserId();
  const rows = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  return rows.length;
}

// ---------------------------------------------------------------------------
// Notification settings + test send
// ---------------------------------------------------------------------------

const settingsSchema = z.object({
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  channelPrefs: z.object({
    inApp: z.boolean(),
    push: z.boolean(),
    email: z.boolean(),
    sms: z.boolean(),
  }),
});

export async function updateNotificationSettings(
  input: z.infer<typeof settingsSchema>,
): Promise<void> {
  const userId = await requireUserId();
  const v = settingsSchema.parse(input);
  await db
    .update(userSettings)
    .set({
      quietHoursStart: v.quietHoursStart,
      quietHoursEnd: v.quietHoursEnd,
      channelPrefs: v.channelPrefs,
    })
    .where(eq(userSettings.userId, userId));
  revalidatePath("/settings");
}

export async function getNotificationSettings() {
  const userId = await requireUserId();
  const [row] = await db
    .select({
      quietHoursStart: userSettings.quietHoursStart,
      quietHoursEnd: userSettings.quietHoursEnd,
      channelPrefs: userSettings.channelPrefs,
      defaultReminders: userSettings.defaultReminders,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return row ?? null;
}

/** "Send a test notification" — proves the pipe end-to-end in one tap. */
export async function sendTestNotification(): Promise<{ push: string; email: string }> {
  const userId = await requireUserId();
  const session = await auth();
  const email = session?.user?.email ?? "";
  const payload = {
    jobId: `test-${crypto.randomUUID()}`,
    userId,
    userEmail: email,
    title: "Test notification — you're all set",
    kind: "event" as const,
    occurrenceAt: new Date(Date.now() + 60 * 60 * 1000),
    location: null,
  };
  const [push, mail] = await Promise.all([
    dispatch("push", payload),
    dispatch("email", payload),
  ]);
  return {
    push: push.ok ? "delivered" : (push.detail ?? "failed"),
    email: mail.ok ? "delivered" : (mail.detail ?? "failed"),
  };
}
