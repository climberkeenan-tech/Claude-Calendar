"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui/card";

/**
 * Fires extraction the moment the page opens and keeps the user company —
 * Opus reading a 40-page syllabus is a genuine 1–2 minute wait, so say so
 * instead of leaving a spinner to gaslight them.
 */
export function ExtractionRunner({
  importId,
  alreadyParsing,
}: {
  importId: string;
  alreadyParsing: boolean;
}) {
  const router = useRouter();
  const started = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;

    const run = async () => {
      try {
        // A row stuck in "parsing" (e.g. the tab was closed mid-run) is
        // safe to re-kick: extraction is idempotent up to the final write.
        const res = await fetch(`/api/imports/${importId}/extract`, {
          method: "POST",
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        // Any failure has to say so. Gating on `body.error` meant a response
        // that wasn't JSON at all — a gateway timeout, an HTML error page —
        // set nothing, and the spinner kept promising "Still working…" over an
        // import that had already stopped.
        if (!res.ok) {
          setError(
            body.error ??
              `Extraction failed (${res.status}). Refresh to try again.`,
          );
          return;
        }
        router.refresh();
      } catch {
        setError("Lost the connection while extracting — reload to retry.");
      }
    };
    void run();
  }, [importId, alreadyParsing, router]);

  const stage =
    elapsed < 8
      ? "Reading your syllabus…"
      : elapsed < 30
        ? "Finding every deadline, exam, and class meeting…"
        : "Still working — long syllabi can take a minute or two…";

  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-3 py-12 text-center">
        {error ? (
          <>
            <p className="text-sm font-medium text-danger-ink">{error}</p>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="text-sm text-accent-ink hover:underline"
            >
              Refresh
            </button>
          </>
        ) : (
          <>
            <span aria-hidden className="animate-pulse text-2xl">
              ✦
            </span>
            <p className="text-sm font-medium text-ink">{stage}</p>
            <p className="max-w-sm text-xs text-ink-faint">
              Claude is extracting dates with the exact text they came from,
              so you can check its work before anything lands on your
              calendar.
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
