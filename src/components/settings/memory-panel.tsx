"use client";

/**
 * What Claude remembers — visible, editable, deletable.
 *
 * A memory you can't see or remove isn't a feature, it's a surprise. Every row
 * Claude saves shows up here immediately, labelled with where it came from,
 * with a Delete next to it. Nothing is hidden behind "learned preferences".
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ActionError, useActionGuard } from "@/components/ui/action-error";
import {
  addMemory,
  deleteMemory,
  pinMemory,
  type MemoryRow,
} from "@/server/memory";

const KIND_LABEL: Record<string, string> = {
  preference: "Preference",
  constraint: "Constraint",
  fact: "Fact",
};

export function MemoryPanel({ memories }: { memories: MemoryRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const guard = useActionGuard();

  const submit = () => {
    const text = draft.trim();
    if (text.length < 3) return;
    startTransition(async () => {
      const ok = await guard.run(async () => {
        const r = await addMemory(text);
        // The action reports its own refusals (too long, list full) rather
        // than throwing — surface those in the same place as a crash, or
        // "save" silently does nothing and the box just empties.
        if (!r.ok) throw new Error(r.error);
        setDraft("");
      }, "Couldn't save that — try again.");
      if (ok) router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader title="What Claude remembers" />
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">
          Things worth keeping between conversations — how you work, when
          you&apos;re unavailable, what a professor does. Claude adds to this
          when you tell it something, and reads all of it before answering.
          Anything here you can delete.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="mem-add" className="sr-only">
            Something to remember
          </label>
          <Input
            id="mem-add"
            value={draft}
            maxLength={500}
            placeholder="e.g. Mornings before 10 are useless to me"
            className="min-w-0 flex-1 basis-64"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button size="sm" disabled={pending || draft.trim().length < 3} onClick={submit}>
            Remember
          </Button>
        </div>
        <ActionError message={guard.error} className="text-xs text-danger-ink" />

        {memories.length === 0 ? (
          <p className="text-xs text-ink-faint">
            Nothing saved yet. Add something above, or just tell Claude — it
            saves what matters and everything it saves appears here.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {memories.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 basis-48 text-sm text-ink">
                  {m.text}
                </span>
                <Badge>{KIND_LABEL[m.kind] ?? m.kind}</Badge>
                <span className="text-xs text-ink-faint">
                  {m.source === "user" ? "you added" : "Claude saved"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  aria-pressed={m.pinned}
                  title={
                    m.pinned
                      ? "Always sent to Claude — click to unpin"
                      : "Pin so it's always sent to Claude"
                  }
                  onClick={() =>
                    startTransition(async () => {
                      const ok = await guard.run(
                        () => pinMemory(m.id, !m.pinned),
                        "Couldn't change that — try again.",
                      );
                      if (ok) router.refresh();
                    })
                  }
                >
                  {m.pinned ? "Pinned" : "Pin"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const ok = await guard.run(
                        () => deleteMemory(m.id),
                        "Couldn't delete that — try again.",
                      );
                      if (ok) router.refresh();
                    })
                  }
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
