import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { focusSessions } from "@/lib/db/schema";

/**
 * Shared focus-timer core — used by the dashboard's server actions AND the MCP
 * tools, for the same reason every other core is shared: the MCP route had its
 * own copy that set `endedAt` but forgot `durationMinutes`, so asking Claude to
 * start a new timer silently erased the minutes of the session it closed.
 */

export type StoppedSession = { id: string; minutes: number; kind: string } | null;

/**
 * Close every open session for a user, writing the elapsed minutes. Safe to
 * call when nothing is running (returns null) and when several are somehow
 * open at once — a crash mid-start can leave an orphan.
 */
export async function stopRunningFor(
  userId: string,
  now: Date = new Date(),
): Promise<StoppedSession> {
  const rows = await db
    .select()
    .from(focusSessions)
    .where(and(eq(focusSessions.userId, userId), isNull(focusSessions.endedAt)));
  if (rows.length === 0) return null;

  let last: StoppedSession = null;
  for (const s of rows) {
    // A session is never worth zero: a one-minute floor keeps a quick start/stop
    // out of the analytics as a session that "happened for no time".
    const minutes = Math.max(
      1,
      Math.round((now.getTime() - s.startedAt.getTime()) / 60000),
    );
    await db
      .update(focusSessions)
      .set({ endedAt: now, durationMinutes: minutes })
      .where(eq(focusSessions.id, s.id));
    last = { id: s.id, minutes, kind: s.kind };
  }
  return last;
}

/** Start a session, closing whatever was running first. */
export async function startSessionFor(
  userId: string,
  input: { kind: "study" | "work" | "reading" | "other"; courseId?: string | null },
): Promise<void> {
  await stopRunningFor(userId);
  await db.insert(focusSessions).values({
    id: crypto.randomUUID(),
    userId,
    kind: input.kind,
    courseId: input.courseId ?? null,
    startedAt: new Date(),
  });
}
