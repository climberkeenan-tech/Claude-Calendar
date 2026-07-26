"use client";

/**
 * OAuth connections (claude.ai, Claude Desktop). Their access renews itself
 * for as long as the connection lives, so "Disconnect" has to be one click
 * and has to be here — a grant you can't see is a grant you can't revoke.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { ActionError, useActionGuard } from "@/components/ui/action-error";
import { fmtIsoDay, isoDay } from "@/lib/time";
import { disconnectClient } from "@/server/oauth";

export type Connection = {
  clientId: string;
  clientName: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
};

export function ConnectedApps({ connections }: { connections: Connection[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const guard = useActionGuard();

  return (
    <Card>
      <CardHeader title="Connected apps" />
      <CardBody className="flex flex-col gap-3">
        {connections.length === 0 ? (
          <EmptyState
            headline="Nothing connected yet"
            hint="Add this app as a custom connector in claude.ai or Claude Desktop and it'll show up here."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {connections.map((c) => (
              <li key={c.clientId} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {c.clientName ?? "MCP client"}
                </span>
                <span className="shrink-0 text-xs text-ink-faint">
                  {c.lastUsedAt
                    ? `used ${fmtIsoDay(isoDay(c.lastUsedAt), { month: "short", day: "numeric" })}`
                    : `connected ${fmtIsoDay(isoDay(c.createdAt), { month: "short", day: "numeric" })}`}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const ok = await guard.run(
                        () => disconnectClient(c.clientId),
                        "Couldn't disconnect — try again.",
                      );
                      if (ok) router.refresh();
                    })
                  }
                >
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}
        <ActionError message={guard.error} />
      </CardBody>
    </Card>
  );
}
