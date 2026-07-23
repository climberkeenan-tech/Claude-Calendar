import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { apiTokens } from "@/lib/db/schema";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return `hpos_${randomBytes(24).toString("hex")}`;
}

/** Bearer token → owning user id, or null. Touches lastUsedAt. */
export async function verifyBearer(token: string): Promise<string | null> {
  if (!token.startsWith("hpos_")) return null;
  const rows = await db
    .select({ id: apiTokens.id, userId: apiTokens.userId })
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hashToken(token)), isNull(apiTokens.revokedAt)));
  if (rows.length === 0) return null;
  await db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, rows[0].id));
  return rows[0].userId;
}
