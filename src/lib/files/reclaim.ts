import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments } from "@/lib/db/schema";
import { deleteStoredFile } from "./storage";

/**
 * Blob cleanup for cascade deletes.
 *
 * attachments.event_id is ON DELETE CASCADE, so removing an event takes its
 * attachment ROWS with it — but the uploaded files are in blob storage, which
 * the database knows nothing about. Every deleted event therefore used to leak
 * its uploads: the lab manual stayed on the bill forever with nothing left
 * pointing at it. Same for undoing a syllabus import.
 *
 * Two steps, because the rows have to be read BEFORE they're gone and the
 * files removed AFTER — a file deleted first would break a delete that then
 * failed and rolled back.
 */

/** URLs the given events' attachments point at. Call BEFORE deleting them. */
export async function attachmentBlobsFor(eventIds: string[]): Promise<string[]> {
  if (eventIds.length === 0) return [];
  const rows = await db
    .select({ blobUrl: attachments.blobUrl })
    .from(attachments)
    .where(inArray(attachments.eventId, eventIds));
  return [...new Set(rows.map((r) => r.blobUrl))];
}

/**
 * Delete the files nothing points at any more. Call AFTER the rows are gone.
 *
 * A blob can be shared: a "this & future" split copies attachment rows forward
 * pointing at the same immutable file. Each is only removed once its LAST
 * claim is, so deleting one half never breaks the other's download.
 *
 * Best-effort by design — a storage hiccup here must not fail a delete the
 * user already saw succeed. The worst case is the leak we already had.
 */
export async function reclaimBlobs(urls: string[]): Promise<void> {
  for (const url of urls) {
    try {
      const claims = await db
        .select({ id: attachments.id })
        .from(attachments)
        .where(eq(attachments.blobUrl, url))
        .limit(1);
      if (claims.length === 0) await deleteStoredFile(url);
    } catch {
      /* leave the file; a later delete of the same URL will retry */
    }
  }
}
