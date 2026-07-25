"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { deleteImport, undoImport } from "@/server/imports";

export function ImportFailed({
  importId,
  error,
}: {
  importId: string;
  error: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [retrying, setRetrying] = React.useState(false);

  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
        <span aria-hidden className="text-2xl">
          ⚠
        </span>
        <p className="max-w-md text-sm font-medium text-ink">
          {error ?? "Extraction failed."}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={retrying || pending}
            onClick={async () => {
              setRetrying(true);
              await fetch(`/api/imports/${importId}/extract`, { method: "POST" });
              router.refresh();
              setRetrying(false);
            }}
          >
            {retrying ? "Retrying…" : "Try again"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={retrying || pending}
            onClick={() =>
              startTransition(async () => {
                await deleteImport(importId);
                router.push("/import");
              })
            }
          >
            Delete upload
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function ImportApproved({
  importId,
  count,
  courseName,
}: {
  importId: string;
  count: number;
  courseName: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
        <span aria-hidden className="text-2xl">
          ✓
        </span>
        <p className="text-sm font-medium text-ink">
          {count} item{count === 1 ? "" : "s"}
          {courseName ? ` from ${courseName}` : ""} are on your calendar.
        </p>
        <p className="max-w-sm text-xs text-ink-faint">
          Changed your mind? Undo removes exactly what this import created —
          nothing else.
        </p>
        {error ? <p className="text-sm text-danger-ink">{error}</p> : null}
        <div className="flex gap-2">
          <Button size="sm" onClick={() => router.push("/calendar")}>
            View calendar
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await undoImport(importId);
                if (res.error) setError(res.error);
                else router.refresh();
              })
            }
          >
            {pending ? "Undoing…" : "Undo this import"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
