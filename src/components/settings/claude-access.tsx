"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionError, useActionGuard } from "@/components/ui/action-error";
import { fmtIsoDay, isoDay } from "@/lib/time";
import {
  createApiToken,
  revokeApiToken,
  type TokenRow,
} from "@/server/tokens";

export function ClaudeAccess({
  tokens,
  appUrl,
}: {
  tokens: TokenRow[];
  appUrl: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [fresh, setFresh] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const guard = useActionGuard();
  const active = tokens.filter((t) => !t.revokedAt);

  return (
    <Card>
      <CardHeader title="Claude access (MCP)" />
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">
          Let Claude read and manage this calendar in conversation. Generate a
          token, then connect from <span className="text-ink">Claude Code</span>:
        </p>
        <pre className="overflow-x-auto rounded-(--radius-sm) border border-border bg-surface-raised p-3 font-mono text-xs text-ink-muted">
          {`claude mcp add high-point-os ${appUrl}/api/mcp \\\n  -t http -H "Authorization: Bearer <your token>"`}
        </pre>

        {fresh ? (
          <div className="flex flex-col gap-2 rounded-(--radius-sm) border border-accent bg-accent-soft p-3">
            <p className="text-xs font-medium text-ink">
              Copy this token now — it won&apos;t be shown again:
            </p>
            <code className="break-all font-mono text-xs text-ink">{fresh}</code>
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              onClick={async () => {
                // Clipboard access can be denied outright (permissions, http).
                const ok = await guard.run(
                  () => navigator.clipboard.writeText(fresh),
                  "Clipboard blocked — select the token above and copy it manually.",
                );
                if (!ok) return;
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Copied ✓" : "Copy token"}
            </Button>
          </div>
        ) : null}

        {active.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {active.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.name}</span>
                <span className="text-xs text-ink-faint">
                  {t.lastUsedAt
                    ? `used ${fmtIsoDay(isoDay(t.lastUsedAt), { month: "short", day: "numeric" })}`
                    : "never used"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const ok = await guard.run(
                        () => revokeApiToken(t.id),
                        "Couldn't revoke that token — try again.",
                      );
                      if (ok) router.refresh();
                    })
                  }
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <Button
          size="sm"
          className="self-start"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const ok = await guard.run(async () => {
                const token = await createApiToken(
                  `Claude access · ${fmtIsoDay(isoDay(new Date()), { month: "short", day: "numeric" })}`,
                );
                setFresh(token);
              }, "Couldn't create a token — try again.");
              if (ok) router.refresh();
            })
          }
        >
          ＋ Generate token
        </Button>
        <ActionError message={guard.error} className="text-xs text-danger-ink" />
        <p className="text-xs text-ink-faint">
          claude.ai and Claude Desktop connectors need OAuth — scheduled for
          Phase 11. Claude Code works today.
        </p>
      </CardBody>
    </Card>
  );
}
