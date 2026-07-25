"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { CategoryDot } from "@/components/ui/badge";
import { saveCourse, deleteCourse } from "@/server/details";
import type { CourseRow } from "@/lib/db/queries/courses";

const COURSE_COLORS = [
  "#6A9BCC",
  "#D97757",
  "#BF4D43",
  "#7D9B76",
  "#C2A87D",
  "#A187BE",
];

type Editing =
  | { mode: "new" }
  | { mode: "edit"; course: CourseRow }
  | null;

export function CourseManager({ courses }: { courses: CourseRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<Editing>(null);
  const [pending, startTransition] = React.useTransition();
  const [confirmDelete, setConfirmDelete] = React.useState<CourseRow | null>(null);

  return (
    <Card>
      <CardHeader
        title={`Courses (${courses.length})`}
        action={
          <Button size="sm" onClick={() => setEditing({ mode: "new" })}>
            ＋ Add course
          </Button>
        }
      />
      <CardBody>
        {courses.length === 0 ? (
          <EmptyState
            headline="No courses yet"
            hint="Add your classes here — or let the Phase 7 syllabus import create them for you."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {courses.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2.5">
                <CategoryDot color={c.color ?? "#6A9BCC"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">
                    {c.code ? <span className="font-mono text-xs text-ink-muted">{c.code}</span> : null}{" "}
                    {c.name}
                  </p>
                  <p className="truncate text-xs text-ink-faint">
                    {[c.professor, c.location, c.term].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditing({ mode: "edit", course: c })}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(c)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      {editing ? (
        <CourseFormDialog
          key={editing.mode === "edit" ? editing.course.id : "new"}
          course={editing.mode === "edit" ? editing.course : null}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <Dialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        {confirmDelete ? (
          <DialogContent
            title={`Delete ${confirmDelete.name}?`}
            description="Events keep their history — they just lose the course link."
          >
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await deleteCourse(confirmDelete.id);
                    setConfirmDelete(null);
                    router.refresh();
                  })
                }
              >
                Delete course
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </Card>
  );
}

function CourseFormDialog({
  course,
  onClose,
}: {
  course: CourseRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(course?.name ?? "");
  const [code, setCode] = React.useState(course?.code ?? "");
  const [professor, setProfessor] = React.useState(course?.professor ?? "");
  const [location, setLocation] = React.useState(course?.location ?? "");
  const [term, setTerm] = React.useState(course?.term ?? "");
  const [color, setColor] = React.useState(course?.color ?? COURSE_COLORS[0]);
  const [error, setError] = React.useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("A course needs a name.");
      return;
    }
    startTransition(async () => {
      await saveCourse({
        id: course?.id ?? null,
        name: name.trim(),
        code: code.trim() || null,
        professor: professor.trim() || null,
        location: location.trim() || null,
        term: term.trim() || null,
        color,
      });
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={course ? "Edit course" : "Add course"}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Name" htmlFor="co-name">
            <Input id="co-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={200} placeholder="Biology I" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code" htmlFor="co-code">
              <Input id="co-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} placeholder="BIO 1500" />
            </Field>
            <Field label="Term" htmlFor="co-term">
              <Input id="co-term" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={60} placeholder="Fall 2026" />
            </Field>
            <Field label="Professor" htmlFor="co-prof">
              <Input id="co-prof" value={professor} onChange={(e) => setProfessor(e.target.value)} maxLength={200} />
            </Field>
            <Field label="Location" htmlFor="co-loc">
              <Input id="co-loc" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
            </Field>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-muted">Color</span>
            <div className="flex gap-2">
              {COURSE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className="flex size-7 items-center justify-center rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? "var(--text)" : "transparent",
                  }}
                />
              ))}
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger-ink">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save course"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
