import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getClient, normalizeScope } from "@/lib/oauth/store";
import { checkAuthorizeRequest } from "@/lib/oauth/authorize-request";
import { redirectWith } from "@/lib/oauth/pkce";
import { ConsentForm } from "@/components/oauth/consent-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect to Claude" };

const SCOPE_COPY: Record<string, string> = {
  "calendar.read": "Read your schedule, deadlines, habits, and focus stats",
  "calendar.write":
    "Add and update events, complete items, reschedule, and start the timer",
};

function Problem({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <span aria-hidden className="text-2xl">
        ⚠
      </span>
      <h1 className="font-display text-2xl text-ink">Can&apos;t connect that app</h1>
      <p className="text-sm text-ink-muted">{message}</p>
      <a href="/settings" className="text-sm text-accent-ink underline underline-offset-2">
        Back to settings
      </a>
    </main>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") query.set(k, v);
  }

  // Don't hit the database for a request that's already malformed.
  const clientId = query.get("client_id") ?? "";
  const client = clientId ? await getClient(clientId) : null;
  const check = checkAuthorizeRequest(query, client);

  // A bad redirect_uri or unknown client dies here — bouncing the error to an
  // unregistered URL is the thing this check exists to prevent.
  if (!check.ok && check.fatal) return <Problem message={check.message} />;
  if (!check.ok) {
    redirect(
      redirectWith(check.redirectUri, {
        error: check.error,
        error_description: check.description,
        state: check.state ?? undefined,
      }),
    );
  }

  // Sign-in happens BEFORE consent, and comes straight back here. The
  // allowlist in the auth config is what stops anyone else approving.
  const session = await auth();
  if (!session?.userId) {
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query.toString()}`)}`);
  }

  const scopes = normalizeScope(check.params.scope).split(" ");
  const clientName = client?.clientName?.trim() || "An MCP client";

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          aria-hidden
          className="flex size-14 items-center justify-center rounded-2xl bg-accent text-2xl text-accent-text shadow-soft"
        >
          ✦
        </div>
        <h1 className="font-display text-2xl text-ink">
          Connect {clientName}?
        </h1>
        <p className="text-sm text-ink-muted">
          Signed in as {session.user?.email}. This lets {clientName} work with
          your calendar on your behalf.
        </p>
      </div>

      <ul className="flex flex-col gap-2 rounded-(--radius) border border-border bg-surface p-4">
        {scopes.map((s) => (
          <li key={s} className="flex items-start gap-2.5 text-sm text-ink">
            <span aria-hidden className="mt-0.5 text-ok-ink">
              ✓
            </span>
            <span>{SCOPE_COPY[s] ?? s}</span>
          </li>
        ))}
      </ul>

      <ConsentForm rawQuery={query.toString()} clientName={clientName} />

      <p className="text-center text-xs text-ink-faint">
        You can disconnect any time from Settings. Access expires after an hour
        and renews only while the connection is active.
      </p>
    </main>
  );
}
