"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { activityLog, categories, events } from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";
import { fromFloating } from "@/lib/tz";
import { applyDefaultReminders } from "@/lib/reminders";

/**
 * Create an item from a confirmed quick-add draft. Wall-clock fields arrive as
 * timezone-less ISO strings and are converted here — the one place quick-add
 * touches the clock.
 */
const draftSchema = z.object({
  title: z.string().trim().min(1).max(300),
  kind: z.enum(["event", "task", "habit"]),
  startLocal: z.string().nullable(), // "2026-09-14T19:00:00"
  durationMinutes: z.number().int().min(5).max(1440).nullable(),
  dueLocal: z.string().nullable(),
  allDay: z.boolean(),
  rrule: z.string().max(200).nullable(),
  categoryName: z.string().nullable(),
  habitTargetPerWeek: z.number().int().min(1).max(7).nullable(),
});

export type QuickAddResult = { ok?: boolean; error?: string; inbox?: boolean };

const TZ = "America/New_York";

function localToInstant(local: string): Date {
  // Accept "YYYY-MM-DDTHH:MM[:SS]" — treat as wall clock in TZ.
  const clean = local.length === 16 ? `${local}:00` : local;
  return fromFloating(new Date(`${clean}Z`), TZ);
}

/**
 * Keep only the recurrence pieces the engine supports (FREQ/INTERVAL/BYDAY).
 * COUNT and UNTIL are stripped: COUNT breaks series-splitting math, and an
 * externally supplied UNTIL can encode the drop-the-last-day bug.
 */
function sanitizeRrule(raw: string | null): string | null {
  if (!raw) return null;
  const allowed = new Set(["FREQ", "INTERVAL", "BYDAY"]);
  const parts = raw
    .split(";")
    .map((p) => p.trim())
    .filter((p) => {
      const key = p.split("=")[0]?.toUpperCase();
      return allowed.has(key);
    });
  if (!parts.some((p) => p.toUpperCase().startsWith("FREQ="))) return null;
  return parts.join(";");
}

export async function createFromDraft(input: unknown): Promise<QuickAddResult> {
  const userId = await requireUserId();
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { error: "That didn't look right — try again." };
  const v = parsed.data;

  // Resolve category by name (quick add offers only existing categories).
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
      const dur = v.allDay ? 24 * 60 : (v.durationMinutes ?? 60);
      endsAt = new Date(startsAt.getTime() + dur * 60 * 1000);
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
  }

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/assignments");
  return { ok: true, inbox };
}
