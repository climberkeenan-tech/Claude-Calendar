"use client";

/**
 * Overdue triage — move, shrink, or drop, one tap each. Gentle by design:
 * these are the "it slipped, that's fine, what now?" buttons.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { triageOverdue } from "@/server/planning";

const ACTIONS = [
  { key: "today", label: "Tonight" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "weekend", label: "Weekend" },
  { key: "shrink", label: "Shrink it" },
  { key: "drop", label: "Drop" },
] as const;

export function TriageChips({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState(false);

  return (
    <span className="flex flex-wrap items-center gap-1">
      {ACTIONS.map((a) => (
        <button
          key={a.key}
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(false);
              const res = await triageOverdue({ taskId, action: a.key });
              if (res.error) setError(true);
              else router.refresh();
            })
          }
          className={cn(
            "min-h-6 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-ink-muted transition-colors",
            "hover:border-border-strong hover:text-ink disabled:opacity-50",
            a.key === "drop" && "hover:border-danger hover:text-danger-ink",
          )}
        >
          {a.label}
        </button>
      ))}
      {error ? (
        <span role="alert" className="text-[11px] text-danger-ink">
          didn&apos;t stick — retry
        </span>
      ) : null}
    </span>
  );
}
