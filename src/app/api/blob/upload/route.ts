/**
 * Client-upload token endpoint. The browser asks here for a single-use token
 * before streaming a file straight to the private Blob store (Vercel caps
 * serverless bodies at ~4.5 MB, so files can't ride through a server action).
 *
 * Security model: the token is minted ONLY for a pathname inside the caller's
 * own `${scope}/${userId}/` prefix, with per-scope MIME + size limits. The
 * blob itself is private — possessing its URL grants nothing.
 */
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/lib/auth";
import {
  SCOPE_RULES,
  pathBelongsTo,
  storageConfigured,
  type FileScope,
} from "@/lib/files/storage";

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  const userId = session?.userId;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!storageConfigured()) {
    return NextResponse.json(
      { error: "File storage isn't configured (BLOB_READ_WRITE_TOKEN)." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let scope: FileScope | null = null;
        try {
          const parsed = JSON.parse(clientPayload ?? "{}") as {
            scope?: string;
          };
          if (parsed.scope === "syllabus" || parsed.scope === "attachments") {
            scope = parsed.scope;
          }
        } catch {
          scope = null;
        }
        if (!scope) throw new Error("Unknown upload scope");
        if (!pathBelongsTo(pathname, scope, userId)) {
          throw new Error("Upload path does not belong to this account");
        }
        const rules = SCOPE_RULES[scope];
        return {
          allowedContentTypes: rules.contentTypes,
          maximumSizeInBytes: rules.maxBytes,
          addRandomSuffix: true,
          // The row-creation server action runs after upload; nothing to do
          // in onUploadCompleted (which can't reach localhost anyway).
          tokenPayload: JSON.stringify({ userId, scope }),
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 },
    );
  }
}
