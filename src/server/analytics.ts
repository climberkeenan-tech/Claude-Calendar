"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { userSettings } from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";

/** The score tile is hideable everywhere it appears — guardrail, not a
 * preference buried in settings. */
export async function setScoreVisibility(visible: boolean): Promise<void> {
  const userId = await requireUserId();
  await db
    .update(userSettings)
    .set({ showProductivityScore: visible })
    .where(eq(userSettings.userId, userId));
  revalidatePath("/analytics");
  revalidatePath("/");
}

/** Personal daily focus target (minutes) — feeds the score's focus part. */
export async function setFocusTarget(minutesPerDay: number | null): Promise<void> {
  const userId = await requireUserId();
  const clean =
    minutesPerDay === null
      ? null
      : Math.max(15, Math.min(600, Math.round(minutesPerDay)));
  await db
    .update(userSettings)
    .set({ focusTargetMinutesPerDay: clean })
    .where(eq(userSettings.userId, userId));
  revalidatePath("/analytics");
}

const schedulingSchema = z.object({
  bufferMinutes: z.number().int().min(0).max(60),
  dayStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  dayEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  maxPlanMinutesPerDay: z.number().int().min(30).max(720),
});

/** Scheduling preferences (Phase 9) — buffers, waking window, daily cap. */
export async function saveSchedulingPrefs(
  input: z.infer<typeof schedulingSchema>,
): Promise<{ ok?: boolean; error?: string }> {
  const userId = await requireUserId();
  const parsed = schedulingSchema.safeParse(input);
  if (!parsed.success) return { error: "Those values didn't look right." };
  const v = parsed.data;
  if (v.dayEnd <= v.dayStart) {
    return { error: "The day has to end after it starts." };
  }
  await db
    .update(userSettings)
    .set({
      transitionBufferMinutes: v.bufferMinutes,
      dayStart: v.dayStart,
      dayEnd: v.dayEnd,
      maxPlanMinutesPerDay: v.maxPlanMinutesPerDay,
    })
    .where(eq(userSettings.userId, userId));
  revalidatePath("/plan");
  revalidatePath("/settings");
  return { ok: true };
}
