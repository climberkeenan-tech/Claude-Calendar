/**
 * Authenticated file serving — the ONLY way stored files reach a browser.
 * Ownership is checked against the DB row (not the URL), then the private
 * blob is streamed through. Logged-out or cross-user requests get nothing.
 */
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { attachments, events, syllabusImports } from "@/lib/db/schema";
import { readStoredFile, safeFilename } from "@/lib/files/storage";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
): Promise<Response> {
  const session = await auth();
  const userId = session?.userId;
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { kind, id } = await params;

  let blobUrl: string | null = null;
  let filename = "file";
  let mime = "application/octet-stream";

  if (kind === "attachment") {
    const rows = await db
      .select({
        blobUrl: attachments.blobUrl,
        filename: attachments.filename,
        mime: attachments.mime,
      })
      .from(attachments)
      .innerJoin(events, eq(attachments.eventId, events.id))
      .where(and(eq(attachments.id, id), eq(events.userId, userId)));
    if (rows[0]) ({ blobUrl, filename, mime } = rows[0]);
  } else if (kind === "import") {
    const rows = await db
      .select({
        blobUrl: syllabusImports.blobUrl,
        filename: syllabusImports.filename,
        mime: syllabusImports.mime,
      })
      .from(syllabusImports)
      .where(and(eq(syllabusImports.id, id), eq(syllabusImports.userId, userId)));
    if (rows[0]) ({ blobUrl, filename, mime } = rows[0]);
  } else {
    return new Response("Not found", { status: 404 });
  }

  if (!blobUrl) return new Response("Not found", { status: 404 });

  const file = await readStoredFile(blobUrl);
  if (!file) return new Response("Not found", { status: 404 });

  // Force download for everything except types browsers render safely
  // inline — serving arbitrary user uploads inline invites XSS-by-upload.
  const inlineSafe = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"];
  const disposition = inlineSafe.includes(mime) ? "inline" : "attachment";

  return new Response(file.stream, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `${disposition}; filename="${safeFilename(filename)}"`,
      ...(file.size ? { "Content-Length": String(file.size) } : {}),
      "Cache-Control": "private, no-store",
      // The MIME comes from whatever the client claimed at upload time. Without
      // this, a browser may sniff past a wrong Content-Type and render an
      // uploaded file as HTML on our own origin.
      //
      // Deliberately NOT adding `Content-Security-Policy: sandbox` as well:
      // it would harden this further, but it also breaks Chrome's built-in
      // PDF viewer, and previewing a syllabus inline is the main reason this
      // route exists. nosniff plus the inline-type allowlist above is the
      // protection that costs nothing.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
