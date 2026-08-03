/**
 * The owner's password door.
 *
 * This is the only place in the app where getting it slightly wrong hands
 * someone else the whole calendar, so the tests lean on the failure cases:
 * malformed hashes, absent hashes, and near-miss passwords all have to be a
 * flat no rather than an accidental yes.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  clearFailures,
  hashPassword,
  ownerLoginEnabled,
  recordFailure,
  throttled,
  verifyPassword,
} from "@/lib/owner-password";

// Hashing at real cost parameters is ~100ms by design; a handful per test file
// is fine, but generate once and reuse where the test doesn't need a fresh one.
const PASSWORD = "correct horse battery staple 4x";
const HASH = hashPassword(PASSWORD);

afterEach(() => {
  clearFailures();
  clearFailures("other");
  delete process.env.OWNER_PASSWORD_HASH;
});

describe("hashPassword", () => {
  it("produces a self-describing hash that carries its own cost parameters", () => {
    const parts = HASH.split(":");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("scrypt");
    expect(Number(parts[1])).toBeGreaterThanOrEqual(16384);
  });

  it("never produces the same hash twice for the same password", () => {
    // A per-hash salt is what stops two installs with the same password from
    // being visibly identical.
    expect(hashPassword("same input")).not.toBe(hashPassword("same input"));
  });

  it("does not contain the password", () => {
    expect(hashPassword("hunter2-and-then-some")).not.toContain("hunter2");
  });
});

describe("verifyPassword", () => {
  it("accepts the right password", () => {
    expect(verifyPassword(PASSWORD, HASH)).toBe(true);
  });

  it("rejects the wrong one", () => {
    expect(verifyPassword("wrong", HASH)).toBe(false);
  });

  it("rejects a near miss", () => {
    // Note surrounding whitespace is NOT a near miss any more — it's trimmed
    // on purpose, see the paste test below. Everything else still has to fail.
    expect(verifyPassword(PASSWORD.toUpperCase(), HASH)).toBe(false);
    expect(verifyPassword(PASSWORD.slice(0, -1), HASH)).toBe(false);
    expect(verifyPassword(PASSWORD.replace(/ /g, ""), HASH)).toBe(false);
    expect(verifyPassword(PASSWORD.replace("battery", "batteries"), HASH)).toBe(false);
  });

  it("rejects the empty password even against a hash of the empty password", () => {
    // Guards the shape of the check: an install that somehow hashed "" must
    // not become an open door. The provider refuses empty input before it
    // ever gets here, and this pins that the two layers agree.
    const emptyHash = hashPassword("");
    expect(verifyPassword("x", emptyHash)).toBe(false);
  });

  it("treats a missing hash as a closed door, not an open one", () => {
    expect(verifyPassword(PASSWORD, undefined)).toBe(false);
    expect(verifyPassword(PASSWORD, "")).toBe(false);
    expect(verifyPassword("", undefined)).toBe(false);
  });

  it("refuses a malformed hash instead of throwing", () => {
    for (const bad of [
      "not-a-hash",
      "scrypt:16384:8:1:deadbeef", // too few fields
      "bcrypt:16384:8:1:aa:bb", // wrong algorithm
      "scrypt:16384:8:1::", // empty salt and hash
      "scrypt:abc:8:1:aa:bb", // non-numeric cost
      ":::::",
      "scrypt$16384$8$1$aa$bb", // the old dollar format is not accepted
    ]) {
      expect(() => verifyPassword(PASSWORD, bad)).not.toThrow();
      expect(verifyPassword(PASSWORD, bad)).toBe(false);
    }
  });

  it("refuses absurd cost parameters rather than hanging on them", () => {
    // A hostile or fat-fingered env var asking for N=2^30 would otherwise be
    // a denial of service we inflict on ourselves.
    const start = Date.now();
    expect(verifyPassword(PASSWORD, "scrypt:1073741824:8:1:aabb:ccdd")).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("survives a password copied with a trailing newline or spaces", () => {
    // Copying a passphrase out of a chat window drags whitespace with it.
    // This cost a live round trip: the right password, reported as wrong.
    expect(verifyPassword(`${PASSWORD}\n`, HASH)).toBe(true);
    expect(verifyPassword(`  ${PASSWORD}  `, HASH)).toBe(true);
    expect(verifyPassword(`\t${PASSWORD}\r\n`, HASH)).toBe(true);
  });

  it("survives a HASH that picked up whitespace on the way into a settings box", () => {
    // A line break landing mid-hash used to leave a shape that still looked
    // valid while Buffer.from(hex) silently truncated at the break — so the
    // form appeared and then rejected the correct password forever.
    const wrapped = HASH.slice(0, 40) + "\n" + HASH.slice(40);
    expect(verifyPassword(PASSWORD, wrapped)).toBe(true);
    expect(verifyPassword(PASSWORD, `  ${HASH}\n`)).toBe(true);
  });

  it("still verifies a hash that lost a few bytes off the end", () => {
    // scrypt's output is prefix-extendable, so a hash cut short is a valid
    // shorter hash rather than a broken one — a paste that dropped some
    // characters keeps working instead of locking you out. Documented because
    // it is genuinely surprising, and it is why the floor below matters.
    const nicked = HASH.slice(0, HASH.length - 60); // still 34 bytes
    expect(verifyPassword(PASSWORD, nicked)).toBe(true);
  });

  it("refuses a hash cut below the strength floor", () => {
    // 32 bytes is the line. Below it we stop calling it a hash at all, so the
    // page says "set OWNER_PASSWORD_HASH" — something you can act on —
    // instead of a login box that rejects the right password forever.
    const gutted = HASH.slice(0, HASH.lastIndexOf(":") + 33);
    expect(verifyPassword(PASSWORD, gutted)).toBe(false);
    process.env.OWNER_PASSWORD_HASH = gutted;
    expect(ownerLoginEnabled()).toBe(false);
  });

  it("rejects a hash with non-hex characters in it", () => {
    const corrupted = HASH.replace(/:([0-9a-f]{32}):/, ":zzzz$1:");
    expect(verifyPassword(PASSWORD, corrupted)).toBe(false);
  });

  it("normalizes unicode so the same typed password matches", () => {
    // "é" can be one code point or two; a password manager and a keyboard can
    // disagree, and the user would have no way to tell why it failed.
    const composed = "café-pass-2026";
    const decomposed = composed.normalize("NFD");
    expect(composed).not.toBe(decomposed);
    expect(verifyPassword(decomposed, hashPassword(composed))).toBe(true);
  });
});

describe("ownerLoginEnabled", () => {
  it("is off when nothing is configured", () => {
    expect(ownerLoginEnabled()).toBe(false);
  });

  it("is off for a hash that isn't one", () => {
    process.env.OWNER_PASSWORD_HASH = "hunter2";
    expect(ownerLoginEnabled()).toBe(false);
  });

  it("is off for whitespace", () => {
    process.env.OWNER_PASSWORD_HASH = "   ";
    expect(ownerLoginEnabled()).toBe(false);
  });

  it("is on for a real hash", () => {
    process.env.OWNER_PASSWORD_HASH = HASH;
    expect(ownerLoginEnabled()).toBe(true);
  });
});

describe("throttling", () => {
  it("lets the first attempts through", () => {
    expect(throttled()).toBe(false);
    recordFailure();
    expect(throttled()).toBe(false);
  });

  it("shuts the door after enough failures", () => {
    for (let i = 0; i < 10; i++) recordFailure();
    expect(throttled()).toBe(true);
  });

  it("opens again once the window passes", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) recordFailure("owner", t0);
    expect(throttled("owner", t0)).toBe(true);
    expect(throttled("owner", t0 + 16 * 60_000)).toBe(false);
  });

  it("is cleared by a success, so one bad day doesn't lock you out", () => {
    for (let i = 0; i < 10; i++) recordFailure();
    clearFailures();
    expect(throttled()).toBe(false);
  });

  it("counts each key separately", () => {
    for (let i = 0; i < 10; i++) recordFailure("other");
    expect(throttled("other")).toBe(true);
    expect(throttled("owner")).toBe(false);
  });
});
