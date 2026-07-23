import { Card, CardBody, EmptyState } from "@/components/ui/card";

export const metadata = { title: "Calendar" };

export default function CalendarPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="font-display text-2xl text-ink">Calendar</h1>
      <Card>
        <CardBody>
          <EmptyState
            headline="The full calendar is Phase 3 — next up"
            hint="Day, week, month, and agenda views with drag-and-drop, recurring events, and natural-language quick add. Until then, everything you add appears on the dashboard."
          />
        </CardBody>
      </Card>
    </div>
  );
}
