"use server";

/**
 * Server actions for what the app remembers.
 *
 * The shapes are declared here rather than re-exported from the store on
 * purpose: Next treats every export of a `"use server"` module as an action to
 * register, and `export type { X }` survives that transform as a runtime
 * reference — which is exactly how quick add shipped returning 500 on every
 * save while 284 tests passed.
 */
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth";
import {
  forgetMemory,
  listMemories,
  rememberFact,
  setPinned,
} from "@/lib/memory/store";

export type MemoryRow = {
  id: string;
  text: string;
  kind: string;
  source: string;
  pinned: boolean;
  createdAt: Date;
};

export type AddMemoryResult = { ok: true } | { ok: false; error: string };

export async function listMemoryRows(): Promise<MemoryRow[]> {
  const userId = await requireUserId();
  return listMemories(userId);
}

/** Something the owner typed in Settings. Marked `user`, not `claude`, so the
 * list can show where each line came from. */
export async function addMemory(
  text: string,
  kind?: string,
): Promise<AddMemoryResult> {
  const userId = await requireUserId();
  const result = await rememberFact(userId, {
    text,
    kind: kind === "preference" || kind === "constraint" ? kind : "fact",
    source: "user",
  });
  revalidatePath("/settings");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function deleteMemory(id: string): Promise<void> {
  const userId = await requireUserId();
  await forgetMemory(userId, id);
  revalidatePath("/settings");
}

export async function pinMemory(id: string, pinned: boolean): Promise<void> {
  const userId = await requireUserId();
  await setPinned(userId, id, pinned);
  revalidatePath("/settings");
}
