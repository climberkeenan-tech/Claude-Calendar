import { requireUserId } from "@/lib/auth";
import { getCalendarWindow } from "@/lib/db/queries/calendar";
import { getCategories } from "@/lib/db/queries/dashboard";
import { listCourses } from "@/lib/db/queries/courses";
import { dayBounds } from "@/lib/time";
import { CalendarShell, type CalendarView } from "@/components/calendar/calendar-shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar" };

const DAY = 24 * 60 * 60 * 1000;

function parseDate(s: string | undefined, fallback: Date): Date {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const view: CalendarView = ["day", "week", "month", "agenda"].includes(params.view ?? "")
    ? (params.view as CalendarView)
    : "week";

  const anchor = parseDate(params.date, new Date());
  const { start: dayStart, isoDay } = dayBounds(anchor);

  // Window per view (generous margins; the client filters precisely).
  let start: Date;
  let end: Date;
  if (view === "day") {
    start = new Date(dayStart.getTime() - DAY);
    end = new Date(dayStart.getTime() + 2 * DAY);
  } else if (view === "week" ) {
    start = new Date(dayStart.getTime() - 8 * DAY);
    end = new Date(dayStart.getTime() + 9 * DAY);
  } else if (view === "month") {
    start = new Date(dayStart.getTime() - 40 * DAY);
    end = new Date(dayStart.getTime() + 47 * DAY);
  } else {
    start = dayStart;
    end = new Date(dayStart.getTime() + 31 * DAY);
  }

  const [items, categories, courses] = await Promise.all([
    getCalendarWindow(userId, start, end),
    getCategories(userId),
    listCourses(userId),
  ]);

  return (
    <CalendarShell
      view={view}
      anchorIso={isoDay}
      items={items}
      categories={categories}
      courses={courses}
    />
  );
}
