"use client";

import * as React from "react";
import { completeEvent } from "@/server/events";

export function CompleteButton({
  eventId,
  title,
}: {
  eventId: string;
  title: string;
}) {
  const [pending, startTransition] = React.useTransition();
  return (
    <button
      type="button"
      aria-label={`Mark “${title}” complete`}
      disabled={pending}
      onClick={() => startTransition(() => completeEvent(eventId))}
      className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border-strong text-transparent transition-colors hover:border-ok hover:bg-ok-soft hover:text-ok disabled:opacity-40"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
        <path
          d="M1.5 5.5 4 8l4.5-6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
