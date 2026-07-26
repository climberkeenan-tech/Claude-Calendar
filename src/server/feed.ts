"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { userSettings } from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";

/** 24 random bytes. The whole security of the subscribe URL rests on this. */
function generateFeedToken(): string {
  return `feed_${randomBytes(24).toString("hex")}`;
}

/**
 * The current subscribe token, minting one on first ask.
 *
 * Mints via a conditional UPDATE rather than read-then-write: two tabs opening
 * Settings at once would otherwise mint two tokens, and the one displayed
 * wouldn't be the one stored — a copy button that hands you a dead URL.
 */
export async function getFeedToken(): Promise<string> {
  const userId = await requireUserId();

  const existing = await db
    .select({ token: userSettings.calendarFeedToken })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  if (existing[0]?.token) return existing[0].token;

  // The settings row is created at sign-in, but never assume it.
  await db
    .insert(userSettings)
    .values({ userId, calendarFeedToken: generateFeedToken() })
    .onConflictDoNothing({ target: userSettings.userId });

  await db
    .update(userSettings)
    .set({ calendarFeedToken: generateFeedToken() })
    .where(
      and(eq(userSettings.userId, userId), isNull(userSettings.calendarFeedToken)),
    );

  const after = await db
    .select({ token: userSettings.calendarFeedToken })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  const token = after[0]?.token;
  if (!token) throw new Error("Could not create a calendar feed link");
  return token;
}

/** Rotate it — every existing subscription stops working immediately. */
export async function rotateFeedToken(): Promise<string> {
  const userId = await requireUserId();
  const token = generateFeedToken();
  const rows = await db
    .update(userSettings)
    .set({ calendarFeedToken: token })
    .where(eq(userSettings.userId, userId))
    .returning({ token: userSettings.calendarFeedToken });
  if (rows.length === 0) throw new Error("Could not reset the calendar feed link");
  revalidatePath("/settings");
  return token;
}
