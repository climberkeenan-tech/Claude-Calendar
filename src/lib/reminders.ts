/**
 * Reminder intent helpers (delivery is Phase 5; Phase 4 creates the intents).
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { reminders, userSettings } from "@/lib/db/schema";

/** The standard offsets menu — minutes before start/due (ARCHITECTURE §7). */
export const STANDARD_OFFSETS: { minutes: number; label: string }[] = [
  { minutes: 7 * 24 * 60, label: "1 week before" },
  { minutes: 3 * 24 * 60, label: "3 days before" },
  { minutes: 24 * 60, label: "1 day before" },
  { minutes: 12 * 60, label: "12 hours before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 30, label: "30 minutes before" },
  { minutes: 15, label: "15 minutes before" },
  { minutes: 5, label: "5 minutes before" },
];

export function offsetLabel(minutes: number): string {
  const std = STANDARD_OFFSETS.find((o) => o.minutes === minutes);
  if (std) return std.label;
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} days before`;
  if (minutes % 60 === 0) return `${minutes / 60} hours before`;
  return `${minutes} minutes before`;
}

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
      channels: ["push", "email"],
    })),
  );
}
