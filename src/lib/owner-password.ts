/**
 * A second real way for the owner to sign in.
 *
 * Google is the intended door and stays the default. But standing up a Google
 * OAuth client means a trip through the Cloud Console, and the redirect URI
 * can't be filled in until the site already has an address — so the very first
 * deploy is a two-pass job that strands you outside your own calendar until
 * you get it exactly right.
 *
 * This is a password, not a way around the password: a high-entropy secret,
 * stored only as a scrypt hash in an environment variable, compared in
 * constant time. When `OWNER_PASSWORD_HASH` is unset the provider is never
 * registered at all, so an install that only wants Google is byte-for-byte
 * what it was before.
 *
 * scrypt because it ships in node:crypto — no native module to fail to build
 * on a serverless runtime, which is exactly the kind of surprise this is
 * meant to avoid.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Cost parameters. N=16384 is ~100ms here, which is the point. */
const N = 16_384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

const PREFIX = "scrypt";

/**
 * `scrypt:N:r:p:salt:hash`, all hex. Self-describing, so the cost parameters
 * can change later without stranding an existing hash.
 *
 * Colons, not the conventional `$`. This value's whole job is to be pasted
 * into an environment variable, and `$` is a variable reference to every
 * dotenv parser and every shell — `scrypt$16384$8$1$...` silently arrives as
 * `scrypt...` with the cost parameters expanded to nothing, and the only
 * symptom is a login form that quietly stops appearing.
 */
export function hashPassword(password: string, salt?: Buffer): string {
  const s = salt ?? randomBytes(SALT_BYTES);
  const derived = scryptSync(password.normalize("NFKC"), s, KEYLEN, {
    N,
    r: R,
    p: P,
    // scrypt needs memory proportional to N*r*128; the default 32MB cap
    // rejects these parameters outright.
    maxmem: 64 * 1024 * 1024,
  });
  return [PREFIX, N, R, P, s.toString("hex"), derived.toString("hex")].join(":");
}

/** Complete, even-length hex and nothing else. */
const HEX = /^(?:[0-9a-fA-F]{2})+$/;

/**
 * Pull a stored hash apart, or null if it isn't one.
 *
 * Whitespace is stripped from the WHOLE string first, not just the ends. A
 * hash pasted into a settings box can pick up a line break in the middle, and
 * `Buffer.from(hex)` stops silently at the first character it doesn't like —
 * so half a salt still parses, still has the right shape, and rejects the
 * correct password with no clue why. Validating the hex properly turns that
 * into "this hash is broken", which is a thing you can act on.
 */
function parseHash(stored: string | undefined) {
  if (!stored) return null;
  const clean = stored.replace(/\s+/g, "");
  const parts = clean.split(":");
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  // Refuse absurd parameters rather than letting a malformed env var become a
  // denial of service against ourselves.
  if (
    !Number.isInteger(n) || n < 1024 || n > 1_048_576 ||
    !Number.isInteger(r) || r < 1 || r > 32 ||
    !Number.isInteger(p) || p < 1 || p > 16
  ) {
    return null;
  }

  if (!HEX.test(parts[4]) || !HEX.test(parts[5])) return null;
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  // A truncated paste is the failure this is really guarding: it would still
  // be valid hex, just short, and short-but-valid is indistinguishable from
  // "wrong password" at the comparison.
  if (salt.length < 8 || expected.length < 32) return null;

  return { n, r, p, salt, expected };
}

/**
 * True only for the right password. Wrong password, malformed hash, missing
 * hash — all false, and all take a comparable amount of time, so nothing here
 * tells an attacker which of those it was.
 */
export function verifyPassword(password: string, stored: string | undefined): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const { n, r, p, salt, expected } = parsed;

  let derived: Buffer;
  try {
    // Trim the typed password. Nobody's passphrase begins or ends with a
    // space, and copying one out of a chat window or a password manager
    // routinely drags a trailing newline along with it — which produced a
    // flat "that password didn't match" for a password that was correct.
    derived = scryptSync(password.trim().normalize("NFKC"), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    });
  } catch {
    return false;
  }

  // Lengths already match by construction, but timingSafeEqual throws on a
  // mismatch rather than returning false, and a throw would leak the length.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Whether the password door exists on this install at all.
 *
 * Deliberately the SAME parse the check uses. When these two disagree — a
 * hash good enough to show the form but not good enough to match anything —
 * you get a login box that rejects the correct password forever, and the
 * screen blames you rather than the setting. Now a broken hash means no form
 * and the "set OWNER_PASSWORD_HASH" message instead.
 */
export function ownerLoginEnabled(): boolean {
  return parseHash(process.env.OWNER_PASSWORD_HASH) !== null;
}

/**
 * A crude brute-force brake.
 *
 * Serverless means this counter is per-instance and resets on a cold start, so
 * it is NOT the thing protecting the account — a 20-character random password
 * is. It exists to make a naive scripted attempt against one warm instance
 * pointless, and it is deliberately not sold as more than that.
 */
const attempts = new Map<string, { n: number; until: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60_000;

export function throttled(key = "owner", now = Date.now()): boolean {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (now > rec.until) {
    attempts.delete(key);
    return false;
  }
  return rec.n >= MAX_ATTEMPTS;
}

export function recordFailure(key = "owner", now = Date.now()): void {
  const rec = attempts.get(key);
  if (!rec || now > rec.until) {
    attempts.set(key, { n: 1, until: now + WINDOW_MS });
    return;
  }
  rec.n += 1;
}

export function clearFailures(key = "owner"): void {
  attempts.delete(key);
}
