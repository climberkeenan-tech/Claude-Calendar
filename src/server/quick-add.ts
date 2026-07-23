"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth";
import { createItemForUser, type QuickAddResult } from "@/lib/items/create";

export type { QuickAddResult };

/** Create an item from a confirmed quick-add draft (thin wrapper — the real
 * logic lives in src/lib/items/create.ts, shared with the MCP server). */
export async function createFromDraft(input: unknown): Promise<QuickAddResult> {
  const userId = await requireUserId();
  const result = await createItemForUser(userId, input);
  if (result.ok) {
    revalidatePath("/");
    revalidatePath("/calendar");
    revalidatePath("/assignments");
  }
  return result;
}
