import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * PKCE and the small pure pieces of the authorization server.
 *
 * OAuth 2.1 makes PKCE mandatory for every client, and `plain` is gone — an
 * authorization code intercepted on the redirect is worthless without the
 * verifier, but only if the challenge was actually hashed. This module refuses
 * anything but S256 on purpose.
 */

export const PKCE_METHOD = "S256";

/** base64url with no padding, per RFC 7636. */
export function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** S256: BASE64URL(SHA256(ASCII(verifier))) */
export function challengeFor(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

/** RFC 7636 §4.1 — 43 to 128 characters from the unreserved set. */
export function isValidVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier);
}

/**
 * Constant-time check that `verifier` produced `challenge`. Rejects anything
 * that isn't S256, and rejects a malformed verifier before hashing it.
 */
export function verifyPkce(
  verifier: string,
  challenge: string,
  method: string,
): boolean {
  if (method !== PKCE_METHOD) return false;
  if (!isValidVerifier(verifier)) return false;
  const expected = Buffer.from(challengeFor(verifier));
  const given = Buffer.from(challenge);
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/** Opaque, high-entropy credential. */
export function randomToken(prefix: string, bytes = 32): string {
  return `${prefix}_${base64url(randomBytes(bytes))}`;
}

/**
 * Redirect URI policy. Exact string matching happens against the registered
 * list; this is the gate on what may be registered at all.
 *
 * Loopback gets an exemption (RFC 8252 — native apps like Claude Desktop have
 * no https origin), and everything else must be https. `http://example.com`
 * or a URI with a fragment would let a network attacker or a sloppy client
 * leak the code.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  }
  return false;
}

/** Exact match, per OAuth 2.1 — no prefix or wildcard matching, ever. */
export function redirectUriMatches(candidate: string, registered: string[]): boolean {
  return registered.includes(candidate);
}

/**
 * Append OAuth response params to a redirect URI, preserving any query the
 * client already put there.
 */
export function redirectWith(
  redirectUri: string,
  params: Record<string, string | undefined>,
): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  return url.toString();
}
