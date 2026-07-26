"use client";

/**
 * The read-only subscribe URL. One copy button, one reset — the two things
 * you ever do with a calendar feed.
 *
 * The URL is shown in full rather than hidden behind a copy button, because
 * pasting it into Google Calendar's "From URL" box is the actual workflow and
 * a masked secret you can't read is worse than useless when the paste fails.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionError, useActionGuard } from "@/components/ui/action-error";
import { rotateFeedToken } from "@/server/feed";

export function CalendarFeed({
  initialToken,
  appUrl,
}: {
  initialToken: string;
  appUrl: string;
}) {
  const [token, setToken] = React.useState(initialToken);
  const [copied, setCopied] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const guard = useActionGuard();

  const url = `${appUrl.replace(/\/$/, "")}/api/calendar/${token}`;
  const webcal = url.replace(/^https?:/, "webcal:");

  return (
    <Card>
      <CardHeader title="Subscribe from another calendar" />
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">
          A read-only feed of your events, habits, and deadlines. Paste it into
          Google Calendar (<span className="text-ink">Other calendars → From URL</span>),
          Apple Calendar (<span className="text-ink">File → New Calendar Subscription</span>),
          or Outlook (<span className="text-ink">Add calendar → Subscribe from web</span>).
          Anyone with this link can read your calendar, so treat it like a
          password.
        </p>

        <code className="block break-all rounded-(--radius-sm) border border-border bg-surface-raised p-3 font-mono text-xs text-ink">
          {url}
        </code>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={async () => {
              const ok = await guard.run(
                () => navigator.clipboard.writeText(url),
                "Clipboard blocked — select the link above and copy it manually.",
              );
              if (!ok) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copied ✓" : "Copy link"}
          </Button>
          <a
            href={webcal}
            className="-my-1 inline-flex min-h-6 items-center text-xs text-accent-ink hover:underline"
          >
            Open in Apple Calendar
          </a>
          <span className="flex-1" />
          {!confirmReset ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirmReset(true)}
            >
              Reset link…
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">
                Existing subscriptions stop updating.
              </span>
              <Button
                size="sm"
                variant="danger"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const ok = await guard.run(async () => {
                      setToken(await rotateFeedToken());
                    }, "Couldn't reset the link — try again.");
                    if (ok) setConfirmReset(false);
                  })
                }
              >
                Reset
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirmReset(false)}
              >
                Keep
              </Button>
            </div>
          )}
        </div>

        <ActionError message={guard.error} />

        <p className="text-xs text-ink-faint">
          Subscribed calendars are read-only and refresh on their own schedule —
          Google usually every few hours, Apple as often as every minute. Edits
          still happen here.
        </p>
      </CardBody>
    </Card>
  );
}
