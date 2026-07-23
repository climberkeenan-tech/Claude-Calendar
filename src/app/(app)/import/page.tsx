import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { syllabusImports } from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { SyllabusUploader } from "@/components/import/uploader";
import type { StoredExtraction } from "@/lib/import/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import" };

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  uploaded: { text: "Ready to extract", cls: "bg-accent-soft text-ink" },
  parsing: { text: "Extracting…", cls: "bg-accent-soft text-ink" },
  review: { text: "Needs review", cls: "bg-warn-soft text-ink" },
  approved: { text: "Imported", cls: "bg-accent text-accent-text" },
  failed: { text: "Failed", cls: "bg-danger-soft text-ink" },
};

export default async function ImportPage() {
  const userId = await requireUserId();
  const imports = await db
    .select({
      id: syllabusImports.id,
      filename: syllabusImports.filename,
      status: syllabusImports.status,
      createdAt: syllabusImports.createdAt,
      extraction: syllabusImports.extraction,
    })
    .from(syllabusImports)
    .where(eq(syllabusImports.userId, userId))
    .orderBy(desc(syllabusImports.createdAt))
    .limit(20);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="font-display text-2xl text-ink">Syllabus import</h1>
      <p className="-mt-3 text-sm text-ink-muted">
        Upload a syllabus; Claude reads out every deadline, exam, and class
        meeting; you review and approve. Nothing touches your calendar without
        your say-so.
      </p>

      <SyllabusUploader />

      {imports.length > 0 ? (
        <Card>
          <CardHeader title="Your imports" />
          <CardBody>
            <ul className="flex flex-col divide-y divide-border">
              {imports.map((imp) => {
                const s = STATUS_LABEL[imp.status] ?? STATUS_LABEL.failed;
                const ext = imp.extraction as StoredExtraction | null;
                const courseName = ext?.result?.course?.name;
                return (
                  <li key={imp.id}>
                    <Link
                      href={`/import/${imp.id}`}
                      className="flex items-center gap-3 py-2.5 hover:bg-surface-raised -mx-2 rounded-(--radius-sm) px-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">
                          {imp.filename}
                        </span>
                        {courseName ? (
                          <span className="block truncate text-xs text-ink-faint">
                            {courseName}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-ink-faint">
                        {imp.createdAt.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}
                      >
                        {s.text}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
