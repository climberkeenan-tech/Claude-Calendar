/**
 * Reminder offsets and their labels — pure, and deliberately in their own
 * module with NO database import.
 *
 * The settings panel and the event sheet are client components and both want
 * these labels. When they lived beside `applyDefaultReminders`, importing a
 * label pulled `@/lib/db/client` into the module graph of the browser bundle:
 * the Neon client and the entire schema, shipped to the browser to render the
 * string "1 hour before".
 */

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
