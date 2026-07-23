"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { apiTokens } from "@/lib/db/schema";
import { requireUserId } from "@/lib/auth";
import { generateToken, hashToken } from "@/lib/mcp/tokens";

export type TokenRow = {
  id: string;
  name: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export async function listApiTokens(): Promise<TokenRow[]> {
  const userId = await requireUserId();
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt));
}

/** Create a token — the plaintext is returned ONCE and never stored. */
export async function createApiToken(name: string): Promise<string> {
  const userId = await requireUserId();
  const clean = name.trim().slice(0, 100) || "Claude access";
  const token = generateToken();
  await db.insert(apiTokens).values({
    id: crypto.randomUUID(),
    userId,
    name: clean,
    tokenHash: hashToken(token),
  });
  revalidatePath("/settings");
  return token;
}

export async function revokeApiToken(tokenId: string): Promise<void> {
  const userId = await requireUserId();
  await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)));
  revalidatePath("/settings");
}
