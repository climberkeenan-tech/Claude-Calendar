"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Input, Field } from "@/components/ui/input";
import { RadioChips, type RadioChipOption } from "@/components/ui/radio-chips";
import { cn } from "@/lib/utils";
import {
  draftToApproveItem,
  toReviewDraft,
  type ReviewDraft,
} from "@/lib/import/map";
import type { SyllabusExtraction } from "@/lib/import/schema";
import { approveImport } from "@/server/imports";

type CourseMode = "create" | "link" | "none";

const COURSE_MODES: readonly RadioChipOption<CourseMode>[] = [
  { value: "create", label: "Create new course" },
  { value: "link", label: "Link existing" },
  { value: "none", label: "No course" },
];

type CourseOption = { id: string; name: string; code: string | null };

const KIND_LABEL: Record<string, string> = {
  class_session: "Class",
  assignment: "Assignment",
  exam: "Exam",
  project: "Project",
  reading: "Reading",
  lab: "Lab",
  holiday: "Holiday",
  other: "Other",
};

/**
 * The review gate (ARCHITECTURE §11): every proposed item is editable,
 * accept/reject-able, and traceable to the exact text it came from. Nothing
 * exists on the calendar until Approve.
 */
export function ImportReview({
  importId,
  extraction,
  courses,
}: {
  importId: string;
  extraction: SyllabusExtraction;
  courses: CourseOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const [drafts, setDrafts] = React.useState<ReviewDraft[]>(() =>
    extraction.items.map((item, i) => toReviewDraft(item, i, extraction.course)),
  );

  // Course choice: default to creating the extracted course, unless one with
  // the same name already exists (then link it).
  const extractedName = extraction.course.name?.trim() ?? "";
  const existingMatch = courses.find(
    (c) => c.name.toLowerCase() === extractedName.toLowerCase(),
  );
  const [courseMode, setCourseMode] = React.useState<CourseMode>(
    existingMatch ? "link" : extractedName ? "create" : "none",
  );
  const [linkCourseId, setLinkCourseId] = React.useState<string>(
    existingMatch?.id ?? courses[0]?.id ?? "",
  );
  const [courseName, setCourseName] = React.useState(extractedName);
  const [courseCode, setCourseCode] = React.useState(extraction.course.code ?? "");
  const [courseProf, setCourseProf] = React.useState(
    extraction.course.professor ?? "",
  );
  const [courseLoc, setCourseLoc] = React.useState(
    extraction.course.location ?? "",
  );

  const patch = (key: string, changes: Partial<ReviewDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...changes } : d)));

  const acceptedCount = drafts.filter((d) => d.accepted && d.date).length;
  const lowConfidence = drafts.filter(
    (d) => d.accepted && d.confidence < 0.8,
  ).length;

  const approve = () =>
    startTransition(async () => {
      setError(null);
      const items = drafts
        .filter((d) => d.accepted)
        .map(draftToApproveItem)
        .filter((x): x is NonNullable<typeof x> => x !== null);
      const course =
        courseMode === "create" && courseName.trim()
          ? {
              mode: "create" as const,
              name: courseName.trim(),
              code: courseCode.trim() || null,
              professor: courseProf.trim() || null,
              location: courseLoc.trim() || null,
              term: extraction.course.term,
            }
          : courseMode === "link" && linkCourseId
            ? { mode: "link" as const, courseId: linkCourseId }
            : null;
      const res = await approveImport({ importId, course, items });
      if (res.error) setError(res.error);
      else router.refresh();
    });

  return (
    <div className="flex flex-col gap-5">
      {/* Course */}
      <Card>
        <CardHeader title="Course" />
        <CardBody className="flex flex-col gap-3">
          <RadioChips
            label="Course handling"
            value={courseMode}
            onChange={setCourseMode}
            className="gap-2"
            chipClassName="rounded-full px-3 py-1 text-sm"
            options={COURSE_MODES}
          />

          {courseMode === "create" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Course name" htmlFor="imp-course-name">
                <Input
                  id="imp-course-name"
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  placeholder="Intro to Biology"
                />
              </Field>
              <Field label="Code" htmlFor="imp-course-code">
                <Input
                  id="imp-course-code"
                  value={courseCode}
                  onChange={(e) => setCourseCode(e.target.value)}
                  placeholder="BIO 1500"
                />
              </Field>
              <Field label="Professor" htmlFor="imp-course-prof">
                <Input
                  id="imp-course-prof"
                  value={courseProf}
                  onChange={(e) => setCourseProf(e.target.value)}
                />
              </Field>
              <Field label="Location" htmlFor="imp-course-loc">
                <Input
                  id="imp-course-loc"
                  value={courseLoc}
                  onChange={(e) => setCourseLoc(e.target.value)}
                />
              </Field>
            </div>
          ) : courseMode === "link" ? (
            <Field label="Course" htmlFor="imp-course-link">
              <select
                id="imp-course-link"
                value={linkCourseId}
                onChange={(e) => setLinkCourseId(e.target.value)}
                className="h-10 w-full rounded-(--radius-sm) border border-border-input bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 sm:max-w-xs"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code ? `${c.code} · ${c.name}` : c.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </CardBody>
      </Card>

      {/* Items */}
      <Card>
        <CardHeader
          title={`Found ${drafts.length} items`}
          action={
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                className="text-accent-ink hover:underline"
                onClick={() =>
                  setDrafts((ds) =>
                    ds.map((d) => ({ ...d, accepted: d.date !== null })),
                  )
                }
              >
                Accept all
              </button>
              <button
                type="button"
                className="text-ink-muted hover:underline"
                onClick={() =>
                  setDrafts((ds) => ds.map((d) => ({ ...d, accepted: false })))
                }
              >
                Reject all
              </button>
            </div>
          }
        />
        <CardBody className="flex flex-col divide-y divide-border">
          {drafts.length === 0 ? (
            <EmptyState
              headline="Claude didn't find any dates in this file"
              hint="Scanned PDFs and image-only syllabi have no text to read. Add the deadlines with Q, or upload a text-based copy."
            />
          ) : null}
          {drafts.map((d) => (
            <div
              key={d.key}
              className={cn(
                "flex flex-col gap-2 border-l-2 py-3 pl-2 transition-colors",
                d.accepted ? "border-l-transparent" : "border-l-border-strong bg-surface-raised/60",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={`Include "${d.title}"`}
                  checked={d.accepted}
                  onChange={(e) => patch(d.key, { accepted: e.target.checked })}
                  className="size-5 shrink-0 accent-(--accent)"
                />
                <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-xs text-ink-muted">
                  {KIND_LABEL[d.originalKind]}
                </span>
                <Input
                  aria-label="Title"
                  value={d.title}
                  onChange={(e) => patch(d.key, { title: e.target.value })}
                  className="h-8 min-w-40 flex-1 text-sm"
                />
                {d.confidence < 0.8 ? (
                  <span
                    className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-ink"
                    title="Claude is less sure about this one — double-check the date."
                  >
                    ⚠ check · {Math.round(d.confidence * 100)}%
                  </span>
                ) : null}
              </div>

              <div className="ml-6 flex flex-wrap items-center gap-2 text-sm">
                <input
                  type="date"
                  aria-label="Date"
                  value={d.date ?? ""}
                  onChange={(e) =>
                    patch(d.key, {
                      date: e.target.value || null,
                      accepted: e.target.value ? d.accepted : false,
                    })
                  }
                  className="h-8 rounded-(--radius-sm) border border-border-input bg-surface px-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
                {d.kind === "event" && d.allDay ? (
                  <span className="text-xs text-ink-faint">all day</span>
                ) : (
                  <input
                    type="time"
                    aria-label={d.kind === "task" ? "Due time" : "Start time"}
                    value={d.startTime ?? (d.kind === "task" ? "23:59" : "")}
                    onChange={(e) =>
                      patch(d.key, { startTime: e.target.value || null })
                    }
                    className="h-8 rounded-(--radius-sm) border border-border-input bg-surface px-2 text-sm text-ink focus:border-accent focus:outline-none"
                  />
                )}
                {d.kind === "event" && !d.allDay && d.durationMinutes ? (
                  <span className="text-xs text-ink-faint">
                    {d.durationMinutes} min
                  </span>
                ) : null}
                {d.rrule ? (
                  <span
                    className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-ink"
                    title={d.rrule}
                  >
                    ↻ repeats
                  </span>
                ) : null}
                {!d.date ? (
                  <span className="text-xs text-warn-ink">
                    no date — set one to include it
                  </span>
                ) : null}
              </div>

              <details className="ml-6">
                <summary className="cursor-pointer text-xs text-ink-faint hover:text-ink-muted">
                  From the syllabus
                </summary>
                <blockquote className="mt-1 border-l-2 border-border pl-3 text-xs text-ink-muted">
                  “{d.sourceExcerpt}”
                </blockquote>
              </details>
            </div>
          ))}
        </CardBody>
      </Card>

      {/* Approve bar */}
      <div className="sticky bottom-16 z-20 flex items-center justify-between gap-3 rounded-(--radius) border border-border bg-surface/95 p-3 shadow-soft backdrop-blur md:bottom-4">
        <div className="min-w-0 text-sm text-ink-muted">
          <span className="font-medium text-ink">{acceptedCount}</span> of{" "}
          {drafts.length} will be added
          {lowConfidence > 0 ? (
            <span className="ml-2 text-xs text-warn-ink">
              {lowConfidence} flagged for a second look
            </span>
          ) : null}
          {error ? (
            <p role="alert" className="mt-0.5 truncate text-xs text-danger-ink">
              {error}
            </p>
          ) : null}
        </div>
        <Button
          onClick={approve}
          disabled={pending || (acceptedCount === 0 && courseMode === "none")}
        >
          {pending ? "Adding…" : `Add ${acceptedCount} to calendar`}
        </Button>
      </div>
    </div>
  );
}
