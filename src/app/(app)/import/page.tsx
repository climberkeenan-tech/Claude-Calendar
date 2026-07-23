import { Card, CardBody, EmptyState } from "@/components/ui/card";

export const metadata = { title: "Import" };

export default function ImportPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="font-display text-2xl text-ink">Syllabus import</h1>
      <Card>
        <CardBody>
          <EmptyState
            headline="Syllabus import is Phase 7"
            hint="Upload a PDF, photo, or Word doc; review what Claude extracted; approve — and the semester lands on your calendar."
          />
        </CardBody>
      </Card>
    </div>
  );
}
