/**
 * Private file storage (ARCHITECTURE §11 + Blob row in §"stack").
 *
 * Everything lives in the Vercel Blob PRIVATE store — a blob URL is never a
 * capability. Reads go through authenticated app routes that check ownership
 * in the DB first; the store itself refuses unauthenticated access.
 *
 * Uploads use Blob client uploads (browser → store directly, with a
 * server-issued single-use token) because Vercel serverless request bodies
 * cap at ~4.5 MB — a photographed syllabus would never fit through a server
 * action.
 */
import { del, get, head } from "@vercel/blob";

export type FileScope = "syllabus" | "attachments";

/** Per-scope upload rules, enforced server-side in the token route. */
export const SCOPE_RULES: Record<
  FileScope,
  { maxBytes: number; contentTypes: string[] }
> = {
  syllabus: {
    // Claude's request cap is 32 MB and base64 inflates ~33% — 15 MB of PDF
    // is the biggest we can reliably hand to extraction in one piece.
    maxBytes: 15 * 1024 * 1024,
    contentTypes: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "text/plain",
    ],
  },
  attachments: {
    maxBytes: 20 * 1024 * 1024,
    // Anything a class hands out: docs, slides, sheets, images, zips.
    contentTypes: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/msword",
      "application/vnd.ms-powerpoint",
      "application/vnd.ms-excel",
      "application/zip",
      "text/plain",
      "text/csv",
      "text/markdown",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/heic",
    ],
  },
};

export function storageConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Keep filenames path-safe without mangling them beyond recognition. */
export function safeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "file";
  return (
    base
      .replace(/[^\w.\- ()]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "file"
  );
}

/** Canonical pathname for a user's file. The `${scope}/${userId}/` prefix is
 * the ownership boundary the token route enforces. */
export function storagePathFor(
  scope: FileScope,
  userId: string,
  filename: string,
): string {
  return `${scope}/${userId}/${safeFilename(filename)}`;
}

export function pathBelongsTo(
  pathname: string,
  scope: FileScope,
  userId: string,
): boolean {
  return pathname.startsWith(`${scope}/${userId}/`);
}

/** Fetch a private blob for server-side use (extraction, download routes). */
export async function readStoredFile(url: string): Promise<{
  stream: ReadableStream;
  contentType: string | null;
  size: number | null;
} | null> {
  const result = await get(url, { access: "private" });
  if (!result || !result.stream) return null;
  return {
    stream: result.stream,
    contentType: result.blob.contentType ?? null,
    size: result.blob.size ?? null,
  };
}

export async function readStoredFileBuffer(url: string): Promise<{
  buffer: Buffer;
  contentType: string | null;
} | null> {
  const file = await readStoredFile(url);
  if (!file) return null;
  const chunks: Uint8Array[] = [];
  const reader = file.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return { buffer: Buffer.concat(chunks), contentType: file.contentType };
}

/** Verify a just-uploaded blob really exists and report its true size/type —
 * never trust the browser's numbers. */
export async function statStoredFile(
  url: string,
): Promise<{ size: number; contentType: string; pathname: string } | null> {
  try {
    const meta = await head(url);
    return {
      size: meta.size,
      contentType: meta.contentType,
      pathname: meta.pathname,
    };
  } catch {
    return null;
  }
}

export async function deleteStoredFile(url: string): Promise<void> {
  try {
    await del(url);
  } catch {
    // Deleting a file that's already gone is success, not failure.
  }
}
