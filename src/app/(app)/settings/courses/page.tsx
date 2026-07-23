import Link from "next/link";
import { requireUserId } from "@/lib/auth";
import { listCourses } from "@/lib/db/queries/courses";
import { CourseManager } from "@/components/settings/course-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Courses" };

export default async function CoursesPage() {
  const userId = await requireUserId();
  const courses = await listCourses(userId);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl text-ink">Courses</h1>
        <Link href="/settings" className="text-xs text-accent hover:underline">
          ← Settings
        </Link>
      </div>
      <CourseManager courses={courses} />
    </div>
  );
}
