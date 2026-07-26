"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { ActionError, useActionGuard } from "@/components/ui/action-error";
import { decideAuthorization } from "@/server/oauth";

/**
 * Approve / Deny. Both go through the same server action, which re-derives
 * the redirect target from the original query rather than trusting anything
 * this form submits.
 */
export function ConsentForm({
  rawQuery,
  clientName,
}: {
  rawQuery: string;
  clientName: string;
}) {
  const [pending, setPending] = React.useState<"approve" | "deny" | null>(null);
  const guard = useActionGuard();

  const decide = async (decision: "approve" | "deny") => {
    if (pending) return;
    setPending(decision);
    const ok = await guard.run(async () => {
      const res = await decideAuthorization(rawQuery, decision);
      if ("error" in res) throw new Error(res.error);
      // A full navigation: the target is the client's site, not a route here.
      window.location.assign(res.redirectTo);
    }, `Couldn't ${decision === "approve" ? "connect" : "cancel"} — try again.`);
    if (!ok) setPending(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={pending !== null}
          onClick={() => decide("approve")}
        >
          {pending === "approve" ? "Connecting…" : `Connect ${clientName}`}
        </Button>
        <Button
          variant="secondary"
          disabled={pending !== null}
          onClick={() => decide("deny")}
        >
          {pending === "deny" ? "…" : "Cancel"}
        </Button>
      </div>
      <ActionError message={guard.error} />
    </div>
  );
}
