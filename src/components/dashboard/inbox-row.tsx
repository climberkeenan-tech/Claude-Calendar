"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { scheduleTask } from "@/server/calendar";
import { CompleteButton } from "./complete-button";

/** An undated capture: complete it, or give it a date in one tap. */
export function InboxRow({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const dateRef = React.useRef<HTMLInputElement>(null);

  return (
    <li className="flex items-center gap-3 rounded-(--radius-sm) px-2 py-2">
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
            await scheduleTask(id, new Date(`${v}T23:59:00`));
            router.refresh();
          });
        }}
        className="w-8 cursor-pointer rounded-md border border-border bg-transparent px-1 py-0.5 text-xs text-transparent [&::-webkit-calendar-picker-indicator]:cursor-pointer"
        title="Schedule it"
      />
    </li>
  );
}
