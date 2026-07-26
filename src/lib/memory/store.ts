import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memories } from "@/lib/db/schema";

/**
 * What the app remembers about its owner.
 *
 * Two halves, deliberately separate:
 *  - `user_patterns` is DERIVED — when they actually focus, what they
 *    underestimate. It is recomputed nightly and is never wrong for long.
 *  - this table is TOLD — "mornings are useless to me", "Dr. Reyes drops the
 *    lowest quiz". Nothing can derive it, and nothing should quietly discard
 *    it either.
 *
 * Shared by the Settings panel and the MCP tools so "what Claude knows" and
 * "what the app shows me" can never disagree.
 */

export type Memory = {
  id: string;
  text: string;
  kind: MemoryKind;
  source: "claude" | "user";
  pinned: boolean;
  createdAt: Date;
};

export const MEMORY_KINDS = ["preference", "constraint", "fact"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** Hard ceiling per person. Memory that grows without bound stops being
 * memory and starts being noise — and it all has to fit in a prompt. */
export const MAX_MEMORIES = 200;
/** How many go to Claude in one context bundle. Pinned ones jump the queue. */
export const CONTEXT_LIMIT = 40;

/** Trim and collapse whitespace so "the same thing" really is the same row. */
export function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export type SaveResult =
  | { ok: true; id: string; created: boolean }
  | { ok: false; error: string };

/**
 * Save one fact. Telling it twice updates the existing row rather than
 * creating a near-duplicate — the unique index does the deciding, so two
 * concurrent saves can't race their way to two rows.
 */
export async function rememberFact(
  userId: string,
  input: { text: string; kind?: MemoryKind; source?: "claude" | "user"; pinned?: boolean },
): Promise<SaveResult> {
  const text = normalizeText(input.text);
  if (text.length < 3) return { ok: false, error: "That's too short to be worth remembering." };
  if (text.length > 500) return { ok: false, error: "That's too long — keep it to a sentence or two." };

  const kind: MemoryKind = MEMORY_KINDS.includes(input.kind as MemoryKind)
    ? (input.kind as MemoryKind)
    : "fact";

  const existing = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.text, text)))
    .limit(1);

  if (existing[0]) {
    await db
      .update(memories)
      .set({ kind, pinned: input.pinned ?? false, lastUsedAt: new Date() })
      .where(eq(memories.id, existing[0].id));
    return { ok: true, id: existing[0].id, created: false };
  }

  const count = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memories)
    .where(eq(memories.userId, userId));
  if ((count[0]?.n ?? 0) >= MAX_MEMORIES) {
    return {
      ok: false,
      error: `That's ${MAX_MEMORIES} things remembered already — delete a few in Settings first.`,
    };
  }

  const id = crypto.randomUUID();
  await db.insert(memories).values({
    id,
    userId,
    text,
    kind,
    source: input.source ?? "claude",
    pinned: input.pinned ?? false,
  });
  return { ok: true, id, created: true };
}

/** Everything remembered, pinned first, newest next. */
export async function listMemories(userId: string): Promise<Memory[]> {
  const rows = await db
    .select()
    .from(memories)
    .where(eq(memories.userId, userId))
    .orderBy(desc(memories.pinned), desc(memories.createdAt));
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    kind: r.kind as MemoryKind,
    source: r.source as "claude" | "user",
    pinned: r.pinned,
    createdAt: r.createdAt,
  }));
}

/** Forget one thing. Scoped by user, so an id alone is never enough. */
export async function forgetMemory(userId: string, id: string): Promise<void> {
  await db.delete(memories).where(and(eq(memories.userId, userId), eq(memories.id, id)));
}

export async function setPinned(userId: string, id: string, pinned: boolean): Promise<void> {
  await db
    .update(memories)
    .set({ pinned })
    .where(and(eq(memories.userId, userId), eq(memories.id, id)));
}

/**
 * The slice that goes to Claude: every pinned memory, then the most recent
 * others up to the limit. Marks them used, so Settings can show what is
 * actually earning its place.
 */
export async function memoriesForContext(userId: string): Promise<Memory[]> {
  const all = await listMemories(userId);
  const chosen = all.slice(0, CONTEXT_LIMIT);
  if (chosen.length > 0) {
    await db
      .update(memories)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(memories.userId, userId),
          inArray(
            memories.id,
            chosen.map((m) => m.id),
          ),
        ),
      );
  }
  return chosen;
}
