import { verifyPkce } from "@/lib/oauth/pkce";
import { checkVerifier } from "@/lib/oauth/authorize-request";
import {
  claimCode,
  getClient,
  issueTokens,
  rotateRefreshToken,
} from "@/lib/oauth/store";
import { JSON_HEADERS } from "@/lib/oauth/metadata";

/**
 * RFC 6749 §3.2 token endpoint, OAuth 2.1 rules.
 *
 * The three things that make this safe, and each is easy to get wrong:
 *  1. the code is single-use (claimed with a conditional UPDATE, so a replay
 *     racing the real exchange still loses);
 *  2. the PKCE verifier is checked in constant time against the challenge the
 *     code was minted with, S256 only;
 *  3. redirect_uri and client_id must match what the code was issued for —
 *     otherwise a code leaked to one client is spendable by another.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { ...JSON_HEADERS, "Cache-Control": "no-store", Pragma: "no-cache" };

function fail(error: string, description: string, status = 400) {
  return Response.json(
    { error, error_description: description },
    { status, headers: NO_STORE },
  );
}

async function readForm(req: Request): Promise<URLSearchParams | null> {
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/x-www-form-urlencoded")) {
      return new URLSearchParams(await req.text());
    }
    if (type.includes("application/json")) {
      const body = (await req.json()) as Record<string, unknown>;
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) {
        if (typeof v === "string") params.set(k, v);
      }
      return params;
    }
  } catch {
    return null;
  }
  return null;
}

export async function POST(req: Request) {
  const form = await readForm(req);
  if (!form) {
    return fail(
      "invalid_request",
      "Body must be application/x-www-form-urlencoded or JSON.",
    );
  }

  const grantType = form.get("grant_type") ?? "";
  const clientId = form.get("client_id") ?? "";
  if (!clientId) return fail("invalid_client", "client_id is required.", 401);

  const client = await getClient(clientId);
  if (!client) return fail("invalid_client", "Unknown client.", 401);

  const now = new Date();

  if (grantType === "refresh_token") {
    const refresh = form.get("refresh_token");
    if (!refresh) return fail("invalid_request", "refresh_token is required.");
    const issued = await rotateRefreshToken(refresh, clientId, now);
    if (!issued) {
      return fail("invalid_grant", "That refresh token is no longer valid.");
    }
    return Response.json(
      {
        access_token: issued.accessToken,
        token_type: "Bearer",
        expires_in: issued.expiresIn,
        refresh_token: issued.refreshToken,
      },
      { headers: NO_STORE },
    );
  }

  if (grantType !== "authorization_code") {
    return fail(
      "unsupported_grant_type",
      "Supported grants: authorization_code, refresh_token.",
    );
  }

  const code = form.get("code");
  if (!code) return fail("invalid_request", "code is required.");

  const verifier = form.get("code_verifier");
  const verifierProblem = checkVerifier(verifier);
  if (verifierProblem) return fail("invalid_request", verifierProblem);

  // Claiming marks it used, so every path below this line has already burned
  // the code — a failed check can't be retried with the same one.
  const claimed = await claimCode(code, now);
  if (!claimed) {
    return fail("invalid_grant", "That code is expired or already used.");
  }
  if (claimed.clientId !== clientId) {
    return fail("invalid_grant", "That code was issued to a different client.");
  }
  const redirectUri = form.get("redirect_uri");
  if (!redirectUri || redirectUri !== claimed.redirectUri) {
    return fail("invalid_grant", "redirect_uri does not match the authorization.");
  }
  if (!verifyPkce(verifier!, claimed.codeChallenge, claimed.codeChallengeMethod)) {
    return fail("invalid_grant", "PKCE verification failed.");
  }

  const issued = await issueTokens({
    userId: claimed.userId,
    clientId: claimed.clientId,
    scope: claimed.scope,
    resource: claimed.resource,
    now,
  });

  return Response.json(
    {
      access_token: issued.accessToken,
      token_type: "Bearer",
      expires_in: issued.expiresIn,
      refresh_token: issued.refreshToken,
      scope: claimed.scope,
    },
    { headers: NO_STORE },
  );
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { ...JSON_HEADERS, "Access-Control-Allow-Methods": "POST, OPTIONS" },
  });
}
