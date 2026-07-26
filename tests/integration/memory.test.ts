/**
 * The memory store, against a real Postgres.
 *
 * The three things that only a real database can answer: whether the unique
 * index really collapses a repeat instead of letting a second row through,
 * whether the cap actually holds, and whether one user can reach another's
 * rows. All three are enforced by SQL, not by TypeScript, so a unit test
 * would be checking my own mock.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memories } from "@/lib/db/schema";
import {
  CONTEXT_LIMIT,
  MAX_MEMORIES,
  forgetMemory,
  listMemories,
  memoriesForContext,
  normalizeText,
  rememberFact,
  setPinned,
} from "@/lib/memory/store";
import { resetDb, seedUser, type Seeded } from "./setup";

let me: Seeded;
let other: Seeded;

beforeAll(async () => {
  await db.execute("select 1");
});

beforeEach(async () => {
  await resetDb();
  me = await seedUser();
  other = await seedUser("someone-else@example.com");
});

describe("normalizeText", () => {
  it("collapses the whitespace that makes duplicates look distinct", () => {
    expect(normalizeText("  I work   Thursdays\n4–8  ")).toBe("I work Thursdays 4–8");
  });
});

describe("rememberFact", () => {
  it("saves one fact and reads it back", async () => {
    const r = await rememberFact(me.userId, { text: "Mornings before 10 are useless" });
    expect(r.ok && r.created).toBe(true);
    const rows = await listMemories(me.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("Mornings before 10 are useless");
    expect(rows[0].kind).toBe("fact");
    expect(rows[0].source).toBe("claude");
  });

  it("updates rather than duplicating when told the same thing twice", async () => {
    await rememberFact(me.userId, { text: "I work Thursdays 4-8", kind: "fact" });
    const second = await rememberFact(me.userId, {
      text: "  I work   Thursdays 4-8 ",
      kind: "constraint",
    });
    expect(second.ok && second.created).toBe(false);
    const rows = await listMemories(me.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("constraint");
  });

  it("refuses a fragment too short to mean anything", async () => {
    const r = await rememberFact(me.userId, { text: "ok" });
    expect(r.ok).toBe(false);
    expect(await listMemories(me.userId)).toHaveLength(0);
  });

  it("refuses an essay", async () => {
    const r = await rememberFact(me.userId, { text: "x".repeat(501) });
    expect(r.ok).toBe(false);
  });

  it("falls back to 'fact' for a kind it doesn't know", async () => {
    // The MCP schema constrains this, but a server action or a future caller
    // can pass anything, and an unknown kind must not become a stored value
    // the UI has no label for.
    await rememberFact(me.userId, {
      text: "Dr. Reyes drops the lowest quiz",
      kind: "vibes" as never,
    });
    expect((await listMemories(me.userId))[0].kind).toBe("fact");
  });

  it("stops at the cap instead of growing without bound", async () => {
    const rows = Array.from({ length: MAX_MEMORIES }, (_, i) => ({
      id: crypto.randomUUID(),
      userId: me.userId,
      text: `remembered thing number ${i}`,
    }));
    await db.insert(memories).values(rows);

    const r = await rememberFact(me.userId, { text: "one more thing" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Settings");
    expect(await db.$count(memories, eq(memories.userId, me.userId))).toBe(MAX_MEMORIES);
  });

  it("lets an update through even when the list is full", async () => {
    // The cap is on new rows. Refusing to CORRECT something because there are
    // 200 of them would mean the only way to fix a wrong memory is to delete
    // something else first.
    const rows = Array.from({ length: MAX_MEMORIES }, (_, i) => ({
      id: crypto.randomUUID(),
      userId: me.userId,
      text: `remembered thing number ${i}`,
    }));
    await db.insert(memories).values(rows);
    const r = await rememberFact(me.userId, {
      text: "remembered thing number 5",
      kind: "preference",
    });
    expect(r.ok).toBe(true);
  });

  it("counts the cap per person, not globally", async () => {
    await rememberFact(other.userId, { text: "not mine at all" });
    await rememberFact(me.userId, { text: "mine alone" });
    expect(await listMemories(me.userId)).toHaveLength(1);
    expect(await listMemories(other.userId)).toHaveLength(1);
  });

  it("keeps the same sentence for two different people apart", async () => {
    // The unique index is (user_id, text), not (text) — a shared phrase must
    // not collide across accounts.
    const a = await rememberFact(me.userId, { text: "Mondays are packed" });
    const b = await rememberFact(other.userId, { text: "Mondays are packed" });
    expect(a.ok && a.created).toBe(true);
    expect(b.ok && b.created).toBe(true);
  });
});

describe("listMemories", () => {
  it("puts pinned things first", async () => {
    await rememberFact(me.userId, { text: "saved first, not pinned" });
    const pinned = await rememberFact(me.userId, { text: "saved second, pinned" });
    if (pinned.ok) await setPinned(me.userId, pinned.id, true);
    const rows = await listMemories(me.userId);
    expect(rows[0].text).toBe("saved second, pinned");
  });

  it("never returns someone else's rows", async () => {
    await rememberFact(other.userId, { text: "their private note" });
    expect(await listMemories(me.userId)).toHaveLength(0);
  });
});

describe("forgetMemory", () => {
  it("deletes your own", async () => {
    const r = await rememberFact(me.userId, { text: "something to drop" });
    if (r.ok) await forgetMemory(me.userId, r.id);
    expect(await listMemories(me.userId)).toHaveLength(0);
  });

  it("cannot delete someone else's, even with the right id", async () => {
    const theirs = await rememberFact(other.userId, { text: "their private note" });
    if (theirs.ok) await forgetMemory(me.userId, theirs.id);
    expect(await listMemories(other.userId)).toHaveLength(1);
  });
});

describe("setPinned", () => {
  it("cannot pin someone else's", async () => {
    const theirs = await rememberFact(other.userId, { text: "their private note" });
    if (theirs.ok) await setPinned(me.userId, theirs.id, true);
    expect((await listMemories(other.userId))[0].pinned).toBe(false);
  });
});

describe("memoriesForContext", () => {
  it("caps what goes to Claude but never drops a pinned one", async () => {
    for (let i = 0; i < CONTEXT_LIMIT + 5; i++) {
      await rememberFact(me.userId, { text: `ordinary memory number ${i}` });
    }
    const late = await rememberFact(me.userId, { text: "the one that always matters" });
    if (late.ok) await setPinned(me.userId, late.id, true);

    const chosen = await memoriesForContext(me.userId);
    expect(chosen).toHaveLength(CONTEXT_LIMIT);
    expect(chosen.map((m) => m.text)).toContain("the one that always matters");
  });

  it("stamps what it used, so Settings can show what earns its place", async () => {
    await rememberFact(me.userId, { text: "a thing that gets used" });
    await memoriesForContext(me.userId);
    const rows = await db.select().from(memories).where(eq(memories.userId, me.userId));
    expect(rows[0].lastUsedAt).not.toBeNull();
  });

  it("is empty and harmless for a user with nothing saved", async () => {
    // The stamping UPDATE takes an id list; an empty list is an easy way to
    // write `in ()`, which is a syntax error in Postgres.
    await expect(memoriesForContext(me.userId)).resolves.toEqual([]);
  });
});
