import { Card, CardBody, EmptyState } from "@/components/ui/card";

export const metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="font-display text-2xl text-ink">Analytics</h1>
      <Card>
        <CardBody>
          <EmptyState
            headline="Analytics arrive in Phase 8"
            hint="Weekly timeline, course workload, productive-day heatmap, and a semester progress bar — built on the focus sessions and completions the earlier phases record."
          />
        </CardBody>
      </Card>
    </div>
  );
}
