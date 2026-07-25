"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ActionError, useActionGuard } from "@/components/ui/action-error";
import { startFocusSession, stopFocusSession, type RunningSession } from "@/server/focus";
import { cn } from "@/lib/utils";

type Course = { id: string; name: string };
const KINDS = [
  { key: "study", label: "Study" },
  { key: "reading", label: "Reading" },
  { key: "work", label: "Work" },
  { key: "other", label: "Other" },
] as const;

function elapsed(from: Date, now: Date): string {
  const s = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

export function StudyTimer({
  running,
  courses,
}: {
  running: RunningSession;
  courses: Course[];
}) {
  const router = useRouter();
  const [kind, setKind] = React.useState<(typeof KINDS)[number]["key"]>("study");
  const [courseId, setCourseId] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const guard = useActionGuard();
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [running]);

  return (
    <Card>
      <CardHeader title="Study timer" />
      <CardBody className="flex flex-col gap-2">
        <ActionError message={guard.error} />
        {running ? (
          <div className="flex flex-col items-center gap-3 py-2">
            <p className="font-mono text-4xl tabular-nums text-ink" aria-live="off">
              {elapsed(running.startedAt, now)}
            </p>
            <p className="text-xs capitalize text-ink-muted">
              {running.kind}
              {running.courseId
                ? ` · ${courses.find((c) => c.id === running.courseId)?.name ?? ""}`
                : ""}
            </p>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const ok = await guard.run(
                    () => stopFocusSession(),
                    "Couldn't save that session — it's still running, try Stop again.",
                  );
                  if (ok) router.refresh();
                })
              }
            >
              ◼ Stop &amp; save
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  onClick={() => setKind(k.key)}
                  aria-pressed={kind === k.key}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    kind === k.key
                      ? "border-accent bg-accent-soft text-ink"
                      : "border-border text-ink-muted hover:border-border-strong",
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>
            {courses.length > 0 ? (
              <select
                aria-label="Course"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="h-9 rounded-(--radius-sm) border border-border-input bg-surface px-2 text-sm text-ink"
              >
                <option value="">No course</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : null}
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const ok = await guard.run(
                    () => startFocusSession({ kind, courseId: courseId || null }),
                    "Couldn't start the timer — check your connection.",
                  );
                  if (ok) router.refresh();
                })
              }
            >
              ▶ Start focusing
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
