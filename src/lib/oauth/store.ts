import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthClients, oauthCodes, oauthTokens } from "@/lib/db/schema";
import { randomToken, sha256 } from "./pkce";

export { DEFAULT_SCOPE, normalizeScope, SCOPES } from "./scopes";

/** Codes are exchanged within seconds; a long TTL is pure attack surface. */
export const CODE_TTL_MS = 5 * 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;

export async function getClient(clientId: string) {
  const rows = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.id, clientId))
    .limit(1);
  return rows[0] ?? null;
}

export async function registerClient(input: {
  clientName: string | null;
  redirectUris: string[];
  grantTypes: string[];
  scope: string;
}) {
  const id = randomToken("client", 16);
  await db.insert(oauthClients).values({ id, ...input });
  return id;
}

export async function issueCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  resource: string | null;
  now: Date;
}): Promise<string> {
  const code = randomToken("code", 32);
  await db.insert(oauthCodes).values({
    codeHash: sha256(code),
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: input.codeChallengeMethod,
    scope: input.scope,
    resource: input.resource,
    expiresAt: new Date(input.now.getTime() + CODE_TTL_MS),
  });
  return code;
}

/**
 * Claim a code for exchange. Single-use is enforced with a conditional UPDATE
 * so two simultaneous exchanges can't both win — replaying a stolen code has
 * to fail even if it arrives at the same instant as the real one.
 */
export async function claimCode(code: string, now: Date) {
  const rows = await db
    .update(oauthCodes)
    .set({ usedAt: now })
    .where(and(eq(oauthCodes.codeHash, sha256(code)), isNull(oauthCodes.usedAt)))
    .returning();
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) return null;
  return row;
}

export async function issueTokens(input: {
  userId: string;
  clientId: string;
  scope: string;
  resource: string | null;
  now: Date;
}) {
  const accessToken = randomToken("hpat", 32);
  const refreshToken = randomToken("hprt", 32);
  await db.insert(oauthTokens).values({
    id: crypto.randomUUID(),
    userId: input.userId,
    clientId: input.clientId,
    accessTokenHash: sha256(accessToken),
    refreshTokenHash: sha256(refreshToken),
    scope: input.scope,
    resource: input.resource,
    expiresAt: new Date(input.now.getTime() + ACCESS_TTL_MS),
  });
  return {
    accessToken,
    refreshToken,
    expiresIn: Math.floor(ACCESS_TTL_MS / 1000),
  };
}

/** Refresh-token rotation: the old row is revoked as the new one is issued. */
export async function rotateRefreshToken(refreshToken: string, clientId: string, now: Date) {
  const rows = await db
    .update(oauthTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(oauthTokens.refreshTokenHash, sha256(refreshToken)),
        eq(oauthTokens.clientId, clientId),
        isNull(oauthTokens.revokedAt),
      ),
    )
    .returning();
  const old = rows[0];
  if (!old) return null;
  return issueTokens({
    userId: old.userId,
    clientId: old.clientId,
    scope: old.scope,
    resource: old.resource,
    now,
  });
}

/** Access token → owning user, or null. Touches lastUsedAt. */
export async function verifyAccessToken(
  token: string,
): Promise<{ userId: string; scope: string } | null> {
  const now = new Date();
  const rows = await db
    .select({
      id: oauthTokens.id,
      userId: oauthTokens.userId,
      scope: oauthTokens.scope,
      expiresAt: oauthTokens.expiresAt,
    })
    .from(oauthTokens)
    .where(
      and(eq(oauthTokens.accessTokenHash, sha256(token)), isNull(oauthTokens.revokedAt)),
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
  await db
    .update(oauthTokens)
    .set({ lastUsedAt: now })
    .where(eq(oauthTokens.id, row.id));
  return { userId: row.userId, scope: row.scope };
}

/** Housekeeping for the nightly cron: expired codes and dead tokens. */
export async function pruneOauth(now: Date): Promise<void> {
  await db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, now));
  await db
    .delete(oauthTokens)
    .where(
      or(
        lt(oauthTokens.expiresAt, new Date(now.getTime() - 30 * 86_400_000)),
        and(
          lt(oauthTokens.revokedAt, new Date(now.getTime() - 30 * 86_400_000)),
        ),
      ),
    );
}
