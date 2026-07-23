import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { courses } from "@/lib/db/schema";

export type CourseRow = {
  id: string;
  name: string;
  code: string | null;
  professor: string | null;
  location: string | null;
  color: string | null;
  term: string | null;
};

export async function listCourses(userId: string): Promise<CourseRow[]> {
  return db
    .select({
      id: courses.id,
      name: courses.name,
      code: courses.code,
      professor: courses.professor,
      location: courses.location,
      color: courses.color,
      term: courses.term,
    })
    .from(courses)
    .where(eq(courses.userId, userId))
    .orderBy(asc(courses.name));
}
