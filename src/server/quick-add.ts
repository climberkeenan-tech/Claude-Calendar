"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth";
import { createItemForUser, type QuickAddResult } from "@/lib/items/create";

// NO `export type { QuickAddResult }` here. Next treats every export of a
// "use server" module as a server action to register, and a re-exported type
// binding survives that transform as a runtime reference — the module then
// threw `ReferenceError: QuickAddResult is not defined` on every call, so the
// primary way into this app returned a 500 and quick add could not save
// anything at all. It compiled, type-checked and built clean; only running it
// showed anything. Import the type from @/lib/items/create instead.

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
