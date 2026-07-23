import { requireUserId } from "@/lib/auth";
import { getDashboardData } from "@/lib/db/queries/dashboard";
import { dayBounds } from "@/lib/time";
import { NowNext } from "@/components/dashboard/now-next";
import { MiniMonth } from "@/components/dashboard/mini-month";
import { QuickAdd } from "@/components/quick-add/quick-add";
import {
  Assignments,
  Deadlines,
  Habits,
  ProductivityScore,
  RecentActivity,
  StudyTimer,
  TodaySchedule,
} from "@/components/dashboard/zones";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const userId = await requireUserId();
  const data = await getDashboardData(userId);
  const { isoDay } = dayBounds(data.now);

  return (
    <div className="flex flex-col gap-5">
      <NowNext current={data.current} next={data.next} />

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <TodaySchedule items={data.today} now={data.now} />
        <Deadlines items={data.deadlines} now={data.now} />
        <MiniMonth monthDots={data.monthDots} todayIso={isoDay} />
        <Assignments items={data.openTasks} />
        <Habits />
        <StudyTimer />
        <ProductivityScore />
        <RecentActivity items={data.activity} />
      </div>

      <QuickAdd categories={data.categories} />
    </div>
  );
}
