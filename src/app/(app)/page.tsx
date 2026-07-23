import { requireUserId } from "@/lib/auth";
import { getDashboardData } from "@/lib/db/queries/dashboard";
import { listCourses } from "@/lib/db/queries/courses";
import { getRunningSession } from "@/server/focus";
import { dayBounds } from "@/lib/time";
import { NowNext } from "@/components/dashboard/now-next";
import { MiniMonth } from "@/components/dashboard/mini-month";
import { StudyTimer } from "@/components/dashboard/study-timer";
import {
  Deadlines,
  Habits,
  InboxZone,
  ProductivityScore,
  RecentActivity,
  TodaySchedule,
} from "@/components/dashboard/zones";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const userId = await requireUserId();
  const [data, courses, running] = await Promise.all([
    getDashboardData(userId),
    listCourses(userId),
    getRunningSession(),
  ]);
  const { isoDay } = dayBounds(data.now);

  return (
    <div className="flex flex-col gap-5">
      <NowNext current={data.current} next={data.next} />

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <TodaySchedule items={data.today} now={data.now} />
        <Deadlines items={data.deadlines} now={data.now} />
        <MiniMonth monthDots={data.monthDots} todayIso={isoDay} />
        <Habits habits={data.habits} weekStartIso={data.weekStartIso} />
        <InboxZone items={data.inbox} />
        <StudyTimer running={running} courses={courses} />
        <ProductivityScore />
        <RecentActivity items={data.activity} />
      </div>

    </div>
  );
}
