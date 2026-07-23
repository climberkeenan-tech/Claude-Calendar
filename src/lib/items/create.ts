/**
 * Shared item-creation core — the ONE path that turns a confirmed draft into
 * rows. Both the quick-add server action and the MCP `quick_add` tool call
 * this, so app and Claude behavior can never drift (ARCHITECTURE §3).
 */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { activityLog, categories, events } from "@/lib/db/schema";
import { fromFloating } from "@/lib/tz";
import { applyDefaultReminders } from "@/lib/reminders";
import { sanitizeRrule } from "@/lib/calendar/sanitize";
import { syncJobsForEvent } from "@/lib/notifications/scheduler";

export const draftSchema = z.object({
  title: z.string().trim().min(1).max(300),
  kind: z.enum(["event", "task", "habit"]),
  startLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)
    .nullable(), // "2026-09-14T19:00:00" — malformed strings must fail Zod, not crash Intl
  durationMinutes: z.number().int().min(5).max(1440).nullable(),
  dueLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)
    .nullable(),
  allDay: z.boolean(),
  rrule: z.string().max(200).nullable(),
  categoryName: z.string().nullable(),
  habitTargetPerWeek: z.number().int().min(1).max(7).nullable(),
});

export type QuickAddResult = {
  ok?: boolean;
  error?: string;
  inbox?: boolean;
  id?: string;
};

const TZ = "America/New_York";

export function localToInstant(local: string): Date {
  // Accept "YYYY-MM-DDTHH:MM[:SS]" — treat as wall clock in TZ.
  const clean = local.length === 16 ? `${local}:00` : local;
  return fromFloating(new Date(`${clean}Z`), TZ);
}

export async function createItemForUser(
  userId: string,
  input: unknown,
): Promise<QuickAddResult> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { error: "That didn't look right — try again." };
  const v = parsed.data;

  // Resolve category by name (drafts only reference existing categories).
  let categoryId: string | null = null;
  if (v.categoryName) {
    const cat = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.userId, userId), eq(categories.name, v.categoryName)))
      .orderBy(asc(categories.position))
      .limit(1);
    categoryId = cat[0]?.id ?? null;
  }

  const id = crypto.randomUUID();
  const rrule = sanitizeRrule(v.rrule);
  let startsAt: Date | null = null;
  let endsAt: Date | null = null;
  let dueAt: Date | null = null;
  let inbox = false;

  if (v.kind === "task") {
    dueAt = v.dueLocal ? localToInstant(v.dueLocal) : null;
    inbox = dueAt === null; // undated capture → Inbox, no interrogation
  } else {
    if (v.startLocal) {
      startsAt = localToInstant(v.startLocal);
      if (v.allDay) {
        // All-day = local midnight to NEXT local midnight (23/24/25 h on DST
        // days — a flat +24 h leaks into the neighboring day twice a year).
        const dayIso = v.startLocal.slice(0, 10);
        const nextIso = new Date(
          new Date(`${dayIso}T12:00:00Z`).getTime() + 24 * 60 * 60 * 1000,
        )
          .toISOString()
          .slice(0, 10);
        startsAt = fromFloating(new Date(`${dayIso}T00:00:00Z`), TZ);
        endsAt = fromFloating(new Date(`${nextIso}T00:00:00Z`), TZ);
      } else {
        endsAt = new Date(
          startsAt.getTime() + (v.durationMinutes ?? 60) * 60 * 1000,
        );
      }
    } else if (v.kind === "habit") {
      // Habit without a time: anchor the series at today 00:00 local.
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ,
      }).format(new Date());
      startsAt = localToInstant(`${today}T00:00:00`);
      endsAt = null;
    } else {
      // Event without any date/time → capture as an Inbox task instead.
      inbox = true;
    }
  }

  await db.insert(events).values({
    id,
    userId,
    title: v.title,
    kind: inbox ? "task" : v.kind,
    categoryId,
    startsAt: inbox ? null : startsAt,
    endsAt: inbox ? null : endsAt,
    allDay: v.allDay && !inbox,
    dueAt,
    // Recurrence requires a startsAt anchor: expansion is startsAt-driven, so
    // a "task with rrule" would silently never recur — store it as one-off.
    rrule: inbox || v.kind === "task" || !startsAt ? null : rrule,
    tz: TZ,
    habitTargetPerWeek: v.kind === "habit" ? (v.habitTargetPerWeek ?? 7) : null,
    source: "quick_add",
  });
  await db.insert(activityLog).values({
    id: crypto.randomUUID(),
    userId,
    type: inbox ? "captured_to_inbox" : "event_created",
    entityType: "event",
    entityId: id,
    data: { title: v.title, kind: v.kind },
  });
  // Per-category default reminders (max 2 — anti-fatigue by design).
  if (!inbox && v.kind !== "habit") {
    await applyDefaultReminders(userId, id, v.categoryName);
    await syncJobsForEvent(id);
  }

  return { ok: true, inbox, id };
}
