"use server";

/**
 * File actions: upload-path minting (the client never guesses its own
 * storage prefix) and event attachments (deferred from Phase 4 to ride the
 * Phase 7 storage layer).
 */
import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { attachments, events } from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";
import {
  deleteStoredFile,
  pathBelongsTo,
  SCOPE_RULES,
  statStoredFile,
  storagePathFor,
  type FileScope,
} from "@/lib/files/storage";

/** Where the browser should upload this file. Scope rules are re-enforced
 * server-side when the token is minted — this is just the address. */
export async function uploadPathFor(
  scope: FileScope,
  filename: string,
): Promise<string> {
  const userId = await requireUserId();
  return storagePathFor(scope, userId, filename);
}

async function assertOwnedEvent(userId: string, eventId: string) {
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.userId, userId)));
  if (rows.length === 0) throw new Error("Event not found");
}

export type AttachmentRow = {
  id: string;
  filename: string;
  mime: string;
  size: number;
};

export async function listAttachments(eventId: string): Promise<AttachmentRow[]> {
  const userId = await requireUserId();
  await assertOwnedEvent(userId, eventId);
  return db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      mime: attachments.mime,
      size: attachments.size,
    })
    .from(attachments)
    .where(eq(attachments.eventId, eventId))
    .orderBy(asc(attachments.createdAt));
}

const attachSchema = z.object({
  eventId: z.string(),
  url: z.string().url().max(1000),
  pathname: z.string().max(500),
  filename: z.string().trim().min(1).max(200),
});

export async function attachFileToEvent(
  input: z.infer<typeof attachSchema>,
): Promise<{ id?: string; error?: string }> {
  const userId = await requireUserId();
  const parsed = attachSchema.safeParse(input);
  if (!parsed.success) return { error: "That upload didn't look right." };
  const v = parsed.data;
  await assertOwnedEvent(userId, v.eventId);

  if (!pathBelongsTo(v.pathname, "attachments", userId)) {
    return { error: "That file doesn't belong to your account." };
  }
  const meta = await statStoredFile(v.url);
  if (!meta || !pathBelongsTo(meta.pathname, "attachments", userId)) {
    return { error: "Upload not found — try again." };
  }
  const rules = SCOPE_RULES.attachments;
  if (meta.size > rules.maxBytes) {
    await deleteStoredFile(v.url);
    return { error: "That file is too large." };
  }

  const id = crypto.randomUUID();
  await db.insert(attachments).values({
    id,
    eventId: v.eventId,
    blobUrl: v.url,
    filename: v.filename,
    mime: meta.contentType,
    size: meta.size,
  });
  return { id };
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  const userId = await requireUserId();
  const rows = await db
    .select({ id: attachments.id, blobUrl: attachments.blobUrl })
    .from(attachments)
    .innerJoin(events, eq(attachments.eventId, events.id))
    .where(and(eq(attachments.id, attachmentId), eq(events.userId, userId)));
  const row = rows[0];
  if (!row) return;
  await deleteStoredFile(row.blobUrl);
  await db.delete(attachments).where(eq(attachments.id, attachmentId));
  revalidatePath("/calendar");
}
