"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { activityLog, focusSessions } from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";
import { ownedCourseId } from "@/lib/db/ownership";
import { startSessionFor, stopRunningFor } from "@/lib/items/focus";

export type RunningSession = {
  id: string;
  kind: "study" | "work" | "reading" | "other";
  courseId: string | null;
  startedAt: Date;
} | null;

export async function getRunningSession(): Promise<RunningSession> {
  const userId = await requireUserId();
  const rows = await db
    .select({
      id: focusSessions.id,
      kind: focusSessions.kind,
      courseId: focusSessions.courseId,
      startedAt: focusSessions.startedAt,
    })
    .from(focusSessions)
    .where(and(eq(focusSessions.userId, userId), isNull(focusSessions.endedAt)))
    .orderBy(desc(focusSessions.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

const startSchema = z.object({
  kind: z.enum(["study", "work", "reading", "other"]),
  courseId: z.string().nullable(),
});

export async function startFocusSession(
  input: z.infer<typeof startSchema>,
): Promise<void> {
  const userId = await requireUserId();
  const v = startSchema.parse(input);
  // One running session at a time: close any orphan first (crash-safe).
  await startSessionFor(userId, {
    kind: v.kind,
    courseId: await ownedCourseId(userId, v.courseId),
  });
  revalidatePath("/");
}

export async function stopFocusSession(): Promise<void> {
  const userId = await requireUserId();
  const stopped = await stopRunningFor(userId);
  if (stopped) {
    await db.insert(activityLog).values({
      id: crypto.randomUUID(),
      userId,
      type: "focus_session",
      entityType: "focus_session",
      entityId: stopped.id,
      data: { minutes: stopped.minutes, kind: stopped.kind },
    });
  }
  revalidatePath("/");
}

