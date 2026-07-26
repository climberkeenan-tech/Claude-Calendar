import { isValidVerifier, PKCE_METHOD, redirectUriMatches } from "./pkce";

/**
 * Validation of an /authorize request, split out as a pure function so the
 * rules are unit-testable without a database or a session.
 *
 * The distinction that matters: some failures may be reported back to the
 * client by redirect, and some may NOT. If the client_id is unknown or the
 * redirect_uri isn't registered, redirecting would forward the error — and an
 * attacker's chosen URL — on the user's behalf. Those have to be dead ends
 * rendered on this site (OAuth 2.1 §4.1.2.1).
 */

export type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  responseType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string | null;
  state: string | null;
  resource: string | null;
};

export type AuthorizeCheck =
  | { ok: true; params: AuthorizeParams }
  /** Show this on our own page; do NOT redirect. */
  | { ok: false; fatal: true; message: string }
  /** Safe to bounce back to the client's registered redirect_uri. */
  | { ok: false; fatal: false; error: string; description: string; redirectUri: string; state: string | null };

export function checkAuthorizeRequest(
  query: URLSearchParams,
  client: { id: string; redirectUris: string[] } | null,
): AuthorizeCheck {
  const clientId = query.get("client_id") ?? "";
  const redirectUri = query.get("redirect_uri") ?? "";
  const state = query.get("state");

  if (!clientId) {
    return { ok: false, fatal: true, message: "Missing client_id." };
  }
  if (!client) {
    return {
      ok: false,
      fatal: true,
      message: "Unknown client. Remove and re-add the connector so it registers again.",
    };
  }
  if (!redirectUri) {
    return { ok: false, fatal: true, message: "Missing redirect_uri." };
  }
  if (!redirectUriMatches(redirectUri, client.redirectUris)) {
    // Never redirect to an unregistered URI, not even to report the error.
    return {
      ok: false,
      fatal: true,
      message: "This redirect URI isn't registered for that client.",
    };
  }

  // From here on the redirect_uri is trusted, so errors can go back to it.
  const bounce = (error: string, description: string): AuthorizeCheck => ({
    ok: false,
    fatal: false,
    error,
    description,
    redirectUri,
    state,
  });

  const responseType = query.get("response_type") ?? "";
  if (responseType !== "code") {
    return bounce("unsupported_response_type", "Only response_type=code is supported.");
  }

  const codeChallenge = query.get("code_challenge") ?? "";
  const codeChallengeMethod = query.get("code_challenge_method") ?? "";
  if (!codeChallenge) {
    // PKCE is mandatory in OAuth 2.1 — no exception for "trusted" clients.
    return bounce("invalid_request", "code_challenge is required (PKCE).");
  }
  if (codeChallengeMethod !== PKCE_METHOD) {
    return bounce(
      "invalid_request",
      `code_challenge_method must be ${PKCE_METHOD}; "plain" is not accepted.`,
    );
  }
  // The challenge is base64url of a SHA-256 digest: always 43 characters.
  if (!/^[A-Za-z0-9\-._~]{43}$/.test(codeChallenge)) {
    return bounce("invalid_request", "Malformed code_challenge.");
  }

  return {
    ok: true,
    params: {
      clientId,
      redirectUri,
      responseType,
      codeChallenge,
      codeChallengeMethod,
      scope: query.get("scope"),
      state,
      resource: query.get("resource"),
    },
  };
}

/** Token-endpoint side of PKCE input validation. */
export function checkVerifier(verifier: string | null): string | null {
  if (!verifier) return "code_verifier is required.";
  if (!isValidVerifier(verifier)) return "Malformed code_verifier.";
  return null;
}
