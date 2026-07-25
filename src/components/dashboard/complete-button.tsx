"use client";

import * as React from "react";
import { ActionError, useActionGuard } from "@/components/ui/action-error";
import { completeEvent } from "@/server/events";

/**
 * The most-tapped control in the app. The visible ring stays a small 20 px
 * circle so a list of ten deadlines doesn't read as ten buttons, but the
 * TOUCH target is padded out to 28 px — comfortably over WCAG 2.5.8's 24 px
 * floor, which the bare circle missed.
 */
export function CompleteButton({
  eventId,
  title,
}: {
  eventId: string;
  title: string;
}) {
  const [pending, startTransition] = React.useTransition();
  const guard = useActionGuard();
  return (
    <span className="relative flex shrink-0 items-center">
      <button
        type="button"
        aria-label={`Mark “${title}” complete`}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await guard.run(
              () => completeEvent(eventId),
              `Couldn't complete “${title}” — try again.`,
            );
          })
        }
        className="-m-1 flex size-7 shrink-0 items-center justify-center rounded-full p-1 disabled:opacity-40"
      >
        <span className="flex size-5 items-center justify-center rounded-full border border-border-strong text-transparent transition-colors group-hover:border-ok [button:hover>&]:border-ok [button:hover>&]:bg-ok-soft [button:hover>&]:text-ok-ink">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path
              d="M1.5 5.5 4 8l4.5-6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {guard.error ? (
        <ActionError
          message={guard.error}
          className="absolute left-0 top-full z-10 mt-1 w-max max-w-56 rounded-(--radius-sm) border border-danger/40 bg-surface px-2 py-1 text-xs text-danger-ink shadow-soft"
        />
      ) : null}
    </span>
  );
}
