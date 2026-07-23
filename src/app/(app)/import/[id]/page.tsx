import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { courses, syllabusImports } from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";
import { Card, CardBody } from "@/components/ui/card";
import { ExtractionRunner } from "@/components/import/extraction-runner";
import { ImportReview } from "@/components/import/review";
import { ImportFailed, ImportApproved } from "@/components/import/states";
import type { StoredExtraction } from "@/lib/import/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review import" };

export default async function ImportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await requireUserId();
  const { id } = await params;
  const rows = await db
    .select()
    .from(syllabusImports)
    .where(and(eq(syllabusImports.id, id), eq(syllabusImports.userId, userId)));
  const imp = rows[0];
  if (!imp) notFound();

  const myCourses = await db
    .select({ id: courses.id, name: courses.name, code: courses.code })
    .from(courses)
    .where(eq(courses.userId, userId));

  const extraction = imp.extraction as StoredExtraction | null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="min-w-0 truncate font-display text-2xl text-ink">
          {imp.filename}
        </h1>
        <Link
          href="/import"
          className="shrink-0 text-sm text-accent hover:underline"
        >
          ← All imports
        </Link>
      </div>

      {imp.status === "uploaded" || imp.status === "parsing" ? (
        <ExtractionRunner
          importId={imp.id}
          alreadyParsing={imp.status === "parsing"}
        />
      ) : imp.status === "failed" ? (
        <ImportFailed importId={imp.id} error={imp.error} />
      ) : imp.status === "approved" ? (
        <ImportApproved
          importId={imp.id}
          count={extraction?.approvedEventCount ?? 0}
          courseName={extraction?.result?.course?.name ?? null}
        />
      ) : extraction?.result ? (
        <ImportReview
          importId={imp.id}
          extraction={extraction.result}
          courses={myCourses}
        />
      ) : (
        <Card>
          <CardBody>
            <p className="py-6 text-center text-sm text-ink-muted">
              This import has no extraction data — delete it and re-upload.
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
