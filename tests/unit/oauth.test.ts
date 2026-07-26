import { describe, expect, it } from "vitest";
import {
  base64url,
  challengeFor,
  isAllowedRedirectUri,
  isValidVerifier,
  randomToken,
  redirectUriMatches,
  redirectWith,
  verifyPkce,
} from "@/lib/oauth/pkce";
import {
  checkAuthorizeRequest,
  checkVerifier,
} from "@/lib/oauth/authorize-request";
import { normalizeScope } from "@/lib/oauth/scopes";

const CLIENT = {
  id: "client_abc",
  redirectUris: [
    "https://claude.ai/api/mcp/auth_callback",
    "http://localhost:33418/oauth/callback",
  ],
};

const VERIFIER = "a".repeat(43);

function q(over: Record<string, string | null> = {}): URLSearchParams {
  const base: Record<string, string | null> = {
    client_id: CLIENT.id,
    redirect_uri: CLIENT.redirectUris[0],
    response_type: "code",
    code_challenge: challengeFor(VERIFIER),
    code_challenge_method: "S256",
    scope: "calendar.read calendar.write",
    state: "xyz",
    ...over,
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) if (v !== null) p.set(k, v);
  return p;
}

describe("PKCE", () => {
  it("computes S256 challenges per RFC 7636", () => {
    // The RFC's own worked example.
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
    expect(base64url(Buffer.from([251, 255, 190]))).toBe("-_--");
  });

  it("accepts a correct verifier and rejects a wrong one", () => {
    const challenge = challengeFor(VERIFIER);
    expect(verifyPkce(VERIFIER, challenge, "S256")).toBe(true);
    expect(verifyPkce("b".repeat(43), challenge, "S256")).toBe(false);
  });

  it("refuses the plain method outright — OAuth 2.1 removed it", () => {
    // With `plain`, anyone who intercepts the redirect has everything they
    // need; the whole point of requiring PKCE is that they don't.
    //
    // This has to present a CORRECT S256 challenge with the wrong method.
    // Asserting verifyPkce(V, V, "plain") === false proves nothing: those two
    // strings differ, so it returns false even with the method check deleted —
    // which mutation testing confirmed. Only this assertion fails when the
    // guard is removed.
    expect(verifyPkce(VERIFIER, challengeFor(VERIFIER), "plain")).toBe(false);
    expect(verifyPkce(VERIFIER, challengeFor(VERIFIER), "S256")).toBe(true);
    // Every other method name is refused too, including an empty one.
    for (const method of ["", "PLAIN", "s256", "S512", "none"]) {
      expect(verifyPkce(VERIFIER, challengeFor(VERIFIER), method)).toBe(false);
    }
  });

  it("enforces the verifier's length and character set", () => {
    expect(isValidVerifier("a".repeat(42))).toBe(false); // too short
    expect(isValidVerifier("a".repeat(129))).toBe(false); // too long
    expect(isValidVerifier("a".repeat(43))).toBe(true);
    expect(isValidVerifier("abc def" + "a".repeat(36))).toBe(false); // space
    expect(isValidVerifier("-._~" + "a".repeat(39))).toBe(true);
    expect(checkVerifier(null)).toMatch(/required/);
    expect(checkVerifier("short")).toMatch(/Malformed/);
    expect(checkVerifier(VERIFIER)).toBeNull();
  });

  it("mints tokens with real entropy", () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomToken("hpat")));
    expect(seen.size).toBe(200);
    const one = randomToken("hpat", 32);
    expect(one.startsWith("hpat_")).toBe(true);
    expect(one.length).toBeGreaterThan(40);
    expect(one).not.toMatch(/[+/=]/); // base64url, safe in a URL
  });
});

describe("redirect URI policy", () => {
  it("allows https anywhere and http only on loopback", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:33418/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:8080/cb")).toBe(true);
    // Plain http off-loopback hands the code to anyone on the network.
    expect(isAllowedRedirectUri("http://evil.example.com/cb")).toBe(false);
    expect(isAllowedRedirectUri("http://localhost.evil.com/cb")).toBe(false);
  });

  it("rejects fragments and non-http schemes", () => {
    expect(isAllowedRedirectUri("https://claude.ai/cb#frag")).toBe(false);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("data:text/html,x")).toBe(false);
    expect(isAllowedRedirectUri("not a url")).toBe(false);
  });

  it("matches EXACTLY — no prefix or wildcard matching", () => {
    const reg = ["https://claude.ai/cb"];
    expect(redirectUriMatches("https://claude.ai/cb", reg)).toBe(true);
    expect(redirectUriMatches("https://claude.ai/cb/../evil", reg)).toBe(false);
    expect(redirectUriMatches("https://claude.ai/cb?x=1", reg)).toBe(false);
    expect(redirectUriMatches("https://claude.ai/cbb", reg)).toBe(false);
    expect(redirectUriMatches("https://evil.com/cb", reg)).toBe(false);
  });

  it("preserves a query the client already put on its callback", () => {
    const url = redirectWith("https://claude.ai/cb?keep=1", {
      code: "abc",
      state: "xyz",
    });
    expect(url).toBe("https://claude.ai/cb?keep=1&code=abc&state=xyz");
    // An undefined value is omitted, not written as "undefined".
    expect(redirectWith("https://claude.ai/cb", { code: "a", state: undefined })).toBe(
      "https://claude.ai/cb?code=a",
    );
  });
});

describe("/authorize request validation", () => {
  it("accepts a well-formed request", () => {
    const r = checkAuthorizeRequest(q(), CLIENT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.params.clientId).toBe(CLIENT.id);
      expect(r.params.state).toBe("xyz");
      expect(r.params.codeChallengeMethod).toBe("S256");
    }
  });

  it("NEVER redirects when the client or redirect_uri is untrusted", () => {
    // Redirecting here would forward an error — and the user — to an attacker's
    // URL on our authority. These have to be dead ends.
    const unknown = checkAuthorizeRequest(q(), null);
    expect(unknown).toMatchObject({ ok: false, fatal: true });

    const wrongUri = checkAuthorizeRequest(
      q({ redirect_uri: "https://evil.com/cb" }),
      CLIENT,
    );
    expect(wrongUri).toMatchObject({ ok: false, fatal: true });

    const noClient = checkAuthorizeRequest(q({ client_id: null }), CLIENT);
    expect(noClient).toMatchObject({ ok: false, fatal: true });

    const noUri = checkAuthorizeRequest(q({ redirect_uri: null }), CLIENT);
    expect(noUri).toMatchObject({ ok: false, fatal: true });
  });

  it("bounces recoverable errors back to the registered URI, with state", () => {
    const r = checkAuthorizeRequest(q({ response_type: "token" }), CLIENT);
    expect(r).toMatchObject({
      ok: false,
      fatal: false,
      error: "unsupported_response_type",
      redirectUri: CLIENT.redirectUris[0],
      state: "xyz",
    });
  });

  it("requires PKCE, and requires it to be S256", () => {
    expect(checkAuthorizeRequest(q({ code_challenge: null }), CLIENT)).toMatchObject({
      ok: false,
      fatal: false,
      error: "invalid_request",
    });
    const plain = checkAuthorizeRequest(
      q({ code_challenge: VERIFIER, code_challenge_method: "plain" }),
      CLIENT,
    );
    expect(plain).toMatchObject({ ok: false, error: "invalid_request" });
    if (!plain.ok && !plain.fatal) expect(plain.description).toMatch(/plain/);
  });

  it("rejects a malformed challenge (S256 output is always 43 chars)", () => {
    expect(checkAuthorizeRequest(q({ code_challenge: "tooshort" }), CLIENT)).toMatchObject({
      ok: false,
      error: "invalid_request",
    });
    expect(
      checkAuthorizeRequest(q({ code_challenge: "a/b+c=" + "x".repeat(37) }), CLIENT),
    ).toMatchObject({ ok: false, error: "invalid_request" });
  });

  it("carries the RFC 8707 resource through when present", () => {
    const r = checkAuthorizeRequest(
      q({ resource: "https://example.app/api/mcp" }),
      CLIENT,
    );
    expect(r.ok && r.params.resource).toBe("https://example.app/api/mcp");
  });
});

describe("scope handling", () => {
  it("drops scopes this server doesn't issue", () => {
    expect(normalizeScope("calendar.read admin.everything")).toBe("calendar.read");
    expect(normalizeScope("nonsense")).toBe("calendar.read calendar.write");
    expect(normalizeScope(null)).toBe("calendar.read calendar.write");
    expect(normalizeScope("")).toBe("calendar.read calendar.write");
  });

  it("de-duplicates and preserves both real scopes", () => {
    expect(normalizeScope("calendar.read calendar.read calendar.write")).toBe(
      "calendar.read calendar.write",
    );
  });
});
