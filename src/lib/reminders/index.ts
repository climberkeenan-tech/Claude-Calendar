/**
 * Reminder intent helpers (delivery is Phase 5; Phase 4 creates the intents).
 *
 * SERVER ONLY — this module touches the database. Anything a client component
 * needs lives in ./labels, which imports nothing.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { reminders, userSettings } from "@/lib/db/schema";

export { STANDARD_OFFSETS, offsetLabel } from "./labels";

/**
 * Attach the user's per-category default reminders to a newly created event.
 * Defaults are capped at 2 per event by design (anti-fatigue, ARCHITECTURE §7).
 */
export async function applyDefaultReminders(
  userId: string,
  eventId: string,
  categoryName: string | null,
): Promise<void> {
  if (!categoryName) return;
  const rows = await db
    .select({ defaults: userSettings.defaultReminders })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  const offsets = (rows[0]?.defaults?.[categoryName] ?? []).slice(0, 2);
  if (offsets.length === 0) return;
  await db.insert(reminders).values(
    offsets.map((offsetMinutes) => ({
      id: crypto.randomUUID(),
      eventId,
      offsetMinutes,
      // Push first; unacknowledged pushes fall back to email automatically.
      channels: ["push"],
    })),
  );
}
