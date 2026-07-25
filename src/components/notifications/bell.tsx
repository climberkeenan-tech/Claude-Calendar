"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import {
  acknowledgeAll,
  acknowledgeJob,
  backOffCategory,
  snoozeJob,
  type BellItem,
} from "@/server/notifications";
import { fmtShortDay, fmtTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export function NotificationBell({ initial }: { initial: BellItem[] }) {
  const router = useRouter();
  const [items, setItems] = React.useState(initial);
  const [pending, startTransition] = React.useTransition();
  const [note, setNote] = React.useState<string | null>(null);

  // Server refetch (router.refresh) delivers a new feed — adopt it during
  // render (the documented derived-state reset pattern, not an effect).
  const [prevInitial, setPrevInitial] = React.useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setItems(initial);
  }

  const remove = (jobId: string) =>
    setItems((list) => list.filter((i) => i.jobId !== jobId));

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          aria-label={`Notifications${items.length > 0 ? ` — ${items.length} unread` : ""}`}
          className="relative flex size-9 items-center justify-center rounded-(--radius-sm) text-ink-muted transition-colors hover:bg-accent-soft/60 hover:text-ink"
        >
          <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
            <path
              d="M8.5 2a4.2 4.2 0 0 0-4.2 4.2c0 3.1-.9 4.1-1.6 4.9h11.6c-.7-.8-1.6-1.8-1.6-4.9A4.2 4.2 0 0 0 8.5 2ZM7 13.5a1.6 1.6 0 0 0 3 0"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {items.length > 0 ? (
            <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-accent-text">
              {items.length > 9 ? "9+" : items.length}
            </span>
          ) : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[22rem] max-w-[calc(100vw-2rem)] rounded-(--radius) border border-border bg-surface p-2 shadow-raised"
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Notifications
            </p>
            {items.length > 0 ? (
              <button
                className="-my-1 inline-flex min-h-6 items-center text-xs text-accent-ink hover:underline"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setItems([]);
                    await acknowledgeAll();
                  })
                }
              >
                Mark all read
              </button>
            ) : null}
          </div>

          {note ? (
            <p className="mx-2 mb-1 rounded-(--radius-sm) bg-ok-soft px-2 py-1.5 text-xs text-ink">
              {note}
            </p>
          ) : null}

          {items.length === 0 ? (
            <p className="px-2 pb-3 pt-1 text-sm text-ink-muted">
              All caught up.
            </p>
          ) : (
            <ul className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
              {items.map((n) => (
                <li
                  key={n.jobId}
                  className="group rounded-(--radius-sm) px-2 py-2 hover:bg-accent-soft/40"
                >
                  <button
                    className="block w-full text-left"
                    onClick={() => {
                      remove(n.jobId);
                      startTransition(async () => {
                        await acknowledgeJob(n.jobId);
                        router.push(n.kind === "task" ? "/assignments" : "/");
                      });
                    }}
                  >
                    <p className="truncate text-sm text-ink">{n.title}</p>
                    <p className="text-xs text-ink-muted">
                      {n.kind === "task" ? "due " : ""}
                      {fmtShortDay(n.occurrenceAt)} · {fmtTime(n.occurrenceAt)}
                      {n.categoryName ? ` · ${n.categoryName}` : ""}
                    </p>
                  </button>
                  <div
                    className={cn(
                      "mt-1 flex items-center gap-1 text-[11px]",
                      "opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:group-focus-within:opacity-100",
                    )}
                  >
                    {(
                      [
                        ["30m", "30 min"],
                        ["tonight", "Tonight"],
                        ["tomorrow", "Tomorrow"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        disabled={pending}
                        onClick={() => {
                          remove(n.jobId);
                          startTransition(() =>
                            snoozeJob({ jobId: n.jobId, until: key }),
                          );
                        }}
                        className="rounded-full border border-border px-2 py-0.5 text-ink-muted hover:border-border-strong hover:text-ink"
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const msg = await backOffCategory(n.eventId);
                          setNote(msg);
                          setTimeout(() => setNote(null), 5000);
                        })
                      }
                      className="ml-auto rounded-full px-2 py-0.5 text-ink-faint hover:text-ink"
                      title="Fewer reminders for this category"
                    >
                      Too much?
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
