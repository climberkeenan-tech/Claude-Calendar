import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { categories, courses } from "@/lib/db/schema";

/** Null-safe: returns the id if the category belongs to the user, else null.
 * Single-user today, but references must never cross user boundaries. */
export async function ownedCategoryId(
  userId: string,
  categoryId: string | null,
): Promise<string | null> {
  if (!categoryId) return null;
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)));
  return rows.length > 0 ? categoryId : null;
}

export async function ownedCourseId(
  userId: string,
  courseId: string | null,
): Promise<string | null> {
  if (!courseId) return null;
  const rows = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.userId, userId)));
  return rows.length > 0 ? courseId : null;
}
