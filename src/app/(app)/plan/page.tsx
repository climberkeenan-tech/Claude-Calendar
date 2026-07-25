import Link from "next/link";
import { getPlanContext } from "@/server/planning";
import { PlanReview } from "@/components/plan/plan-review";
import { Suggestions } from "@/components/plan/suggestions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan" };

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode: rawMode } = await searchParams;
  const mode = rawMode === "today" ? "today" : "week";
  const context = await getPlanContext(mode);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-display text-2xl text-ink">
          {mode === "today" ? "Replan today" : "Plan my week"}
        </h1>
        <Link
          href={mode === "today" ? "/plan" : "/plan?mode=today"}
          className="text-sm text-accent hover:underline"
        >
          {mode === "today" ? "Plan the whole week →" : "Just replan today →"}
        </Link>
      </div>
      <p className="-mt-3 text-sm text-ink-muted">
        {mode === "today"
          ? "Rolls what slipped forward into the time you still have — one confirm."
          : "Study blocks for every open deadline, placed around your commitments with breathing room. Review, uncheck anything, accept."}
      </p>
      {/* Suggestion surfaces sit above the plan: one-click wins that
          need no review pass. */}
      <Suggestions suggestions={context.suggestions} />
      <PlanReview context={context} />
    </div>
  );
}
