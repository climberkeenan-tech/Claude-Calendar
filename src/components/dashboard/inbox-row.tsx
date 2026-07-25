"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { scheduleTask } from "@/server/calendar";
import { ActionError, useActionGuard } from "@/components/ui/action-error";
import { instantFromWallClock } from "@/lib/time";
import { CompleteButton } from "./complete-button";

/** An undated capture: complete it, or give it a date in one tap. */
export function InboxRow({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const guard = useActionGuard();
  const dateRef = React.useRef<HTMLInputElement>(null);

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-(--radius-sm) px-2 py-2">
      <CompleteButton eventId={id} title={title} />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{title}</span>
      <input
        ref={dateRef}
        type="date"
        aria-label={`Schedule “${title}”`}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          startTransition(async () => {
            // End of the day on campus — not on whatever clock this device has.
            const ok = await guard.run(
              () => scheduleTask(id, instantFromWallClock(v, "23:59")),
              "Couldn't set that date — try again.",
            );
            if (ok) router.refresh();
          });
        }}
        className="h-7 w-9 cursor-pointer rounded-md border border-border-input bg-transparent px-1 text-xs text-transparent [&::-webkit-calendar-picker-indicator]:cursor-pointer"
        title="Schedule it"
      />
      <ActionError message={guard.error} className="basis-full text-xs text-danger-ink" />
    </li>
  );
}
