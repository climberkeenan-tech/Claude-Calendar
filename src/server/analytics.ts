"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
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
