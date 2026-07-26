"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { auth, requireUserId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { oauthClients, oauthTokens } from "@/lib/db/schema";
import { getClient, issueCode, normalizeScope } from "@/lib/oauth/store";
import { checkAuthorizeRequest } from "@/lib/oauth/authorize-request";
import { redirectWith } from "@/lib/oauth/pkce";

/**
 * Approve or deny an authorization request. Re-validates everything from the
 * raw query string rather than trusting hidden form fields — a consent screen
 * that takes the client's word for the redirect URI is how consent gets
 * forged.
 */
export async function decideAuthorization(
  rawQuery: string,
  decision: "approve" | "deny",
): Promise<{ redirectTo: string } | { error: string }> {
  const session = await auth();
  if (!session?.userId) return { error: "Your session expired — sign in again." };

  const query = new URLSearchParams(rawQuery);
  const clientId = query.get("client_id") ?? "";
  const client = clientId ? await getClient(clientId) : null;
  const check = checkAuthorizeRequest(query, client);
  if (!check.ok) {
    return { error: check.fatal ? check.message : check.description };
  }

  const p = check.params;
  if (decision === "deny") {
    return {
      redirectTo: redirectWith(p.redirectUri, {
        error: "access_denied",
        error_description: "The user declined the request.",
        state: p.state ?? undefined,
      }),
    };
  }

  const code = await issueCode({
    clientId: p.clientId,
    userId: session.userId,
    redirectUri: p.redirectUri,
    codeChallenge: p.codeChallenge,
    codeChallengeMethod: p.codeChallengeMethod,
    scope: normalizeScope(p.scope),
    resource: p.resource,
    now: new Date(),
  });

  return {
    redirectTo: redirectWith(p.redirectUri, { code, state: p.state ?? undefined }),
  };
}

/** Live connections, newest first — one row per client that still has a
 * usable token. */
export async function listConnections(): Promise<
  {
    clientId: string;
    clientName: string | null;
    lastUsedAt: Date | null;
    createdAt: Date;
    /** Live tokens this client holds. Normally 1; more means it authorized
     * again without the old grant being revoked, which is worth seeing. */
    sessions: number;
  }[]
> {
  const userId = await requireUserId();
  const rows = await db
    .select({
      clientId: oauthTokens.clientId,
      clientName: oauthClients.clientName,
      lastUsedAt: oauthTokens.lastUsedAt,
      createdAt: oauthTokens.createdAt,
    })
    .from(oauthTokens)
    .innerJoin(oauthClients, eq(oauthTokens.clientId, oauthClients.id))
    .where(and(eq(oauthTokens.userId, userId), isNull(oauthTokens.revokedAt)))
    .orderBy(desc(oauthTokens.createdAt));

  // One client can hold several tokens after refreshes; show the newest. The
  // count rides along rather than being swallowed by the dedupe — a second
  // live grant you didn't expect is exactly the thing worth noticing here.
  const byClient = new Map<string, { row: (typeof rows)[number]; sessions: number }>();
  for (const r of rows) {
    const seen = byClient.get(r.clientId);
    if (seen) seen.sessions += 1;
    else byClient.set(r.clientId, { row: r, sessions: 1 });
  }
  return [...byClient.values()].map(({ row, sessions }) => ({ ...row, sessions }));
}

/** Disconnect: revokes every token that client holds for this user. */
export async function disconnectClient(clientId: string): Promise<void> {
  const userId = await requireUserId();
  await db
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(oauthTokens.userId, userId),
        eq(oauthTokens.clientId, clientId),
        isNull(oauthTokens.revokedAt),
      ),
    );
  revalidatePath("/settings");
}
