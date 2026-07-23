"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { aiInsights, events, reminders } from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";
import { insightActionSchema } from "@/lib/ai/insights";
import { createItemForUser, localToInstant } from "@/lib/items/create";
import { syncJobsForEvent } from "@/lib/notifications/scheduler";

export type InsightRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  hasAction: boolean;
};

export async function getInsights(): Promise<InsightRow[]> {
  const userId = await requireUserId();
  const rows = await db
    .select({
      id: aiInsights.id,
      kind: aiInsights.kind,
      title: aiInsights.title,
      body: aiInsights.body,
      action: aiInsights.action,
    })
    .from(aiInsights)
    .where(
      and(
        eq(aiInsights.userId, userId),
        eq(aiInsights.status, "new"),
        gt(aiInsights.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(aiInsights.createdAt))
    .limit(3);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    hasAction: r.action != null,
  }));
}

/**
 * One-click Accept. The action payload is re-validated against the whitelist
 * union at execution time — an insight can never call arbitrary code.
 */
export async function applyInsight(
  insightId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const userId = await requireUserId();
  const rows = await db
    .select()
    .from(aiInsights)
    .where(and(eq(aiInsights.id, insightId), eq(aiInsights.userId, userId)));
  if (rows.length === 0 || rows[0].status !== "new") {
    return { error: "This suggestion is no longer available." };
  }
  const parsed = insightActionSchema.safeParse(rows[0].action);
  if (!parsed.success) return { error: "This suggestion has no valid action." };
  const action = parsed.data;

  if (action.type === "create_event") {
    const result = await createItemForUser(userId, {
      title: action.title,
      kind: "event",
      startLocal: action.startLocal,
      durationMinutes: action.durationMinutes,
      dueLocal: null,
      allDay: false,
      rrule: null,
      categoryName: action.categoryName,
      habitTargetPerWeek: null,
    });
    if (!result.ok) return { error: "Couldn't create the event." };
  } else {
    // Both remaining actions reference an event — verify ownership.
    const target = await db
      .select({ id: events.id, kind: events.kind })
      .from(events)
      .where(and(eq(events.id, action.eventId), eq(events.userId, userId)));
    if (target.length === 0) return { error: "That item no longer exists." };

    if (action.type === "add_reminder") {
      await db.insert(reminders).values({
        id: crypto.randomUUID(),
        eventId: action.eventId,
        offsetMinutes: action.offsetMinutes,
        channels: ["push"],
      });
      await syncJobsForEvent(action.eventId);
    } else {
      if (target[0].kind !== "task") {
        return { error: "Only tasks can be rescheduled this way." };
      }
      await db
        .update(events)
        .set({ dueAt: localToInstant(action.dueLocal), updatedAt: new Date() })
        .where(eq(events.id, action.eventId));
      await syncJobsForEvent(action.eventId);
    }
  }

  await db
    .update(aiInsights)
    .set({ status: "accepted" })
    .where(eq(aiInsights.id, insightId));
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/assignments");
  return { ok: true };
}

export async function dismissInsight(insightId: string): Promise<void> {
  const userId = await requireUserId();
  await db
    .update(aiInsights)
    .set({ status: "dismissed" })
    .where(and(eq(aiInsights.id, insightId), eq(aiInsights.userId, userId)));
  revalidatePath("/");
}
