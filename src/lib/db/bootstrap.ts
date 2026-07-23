import { eq } from "drizzle-orm";
import { db } from "./client";
import { categories, users, userSettings } from "./schema";

const DEFAULT_CATEGORIES = [
  { name: "Classes", color: "#6A9BCC" },
  { name: "Homework", color: "#D97757" },
  { name: "Exams", color: "#BF4D43" },
  { name: "Personal", color: "#7D9B76" },
  { name: "Work", color: "#C2A87D" },
  { name: "Practice", color: "#A187BE" },
];

const DEFAULT_REMINDERS: Record<string, number[]> = {
  // minutes before start/due — capped at 1–2 per category by design
  Classes: [15],
  Homework: [24 * 60, 60],
  Exams: [7 * 24 * 60, 24 * 60],
  Personal: [30],
  Work: [30],
  Practice: [60],
};

/**
 * Idempotent first-run setup: ensures the signed-in account has a user row,
 * settings, and the six default categories. Returns the user id.
 */
export async function ensureUser(profile: {
  email: string;
  name?: string | null;
  image?: string | null;
}): Promise<string> {
  const email = profile.email.toLowerCase();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing.length > 0) return existing[0].id;

  const userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    email,
    name: profile.name ?? null,
    image: profile.image ?? null,
  });
  await db.insert(userSettings).values({
    userId,
    defaultReminders: DEFAULT_REMINDERS,
  });
  await db.insert(categories).values(
    DEFAULT_CATEGORIES.map((c, i) => ({
      id: crypto.randomUUID(),
      userId,
      name: c.name,
      color: c.color,
      isDefault: true,
      position: i,
    })),
  );
  return userId;
}
