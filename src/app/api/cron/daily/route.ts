import { NextResponse } from "next/server";
import { dailyMaintenance } from "@/lib/notifications/scheduler";

export const maxDuration = 300;

/**
 * Daily maintenance (Vercel cron — Hobby fires this once a day at an
 * arbitrary minute within the hour; nothing time-precise lives here).
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` automatically
 * when the env var is set.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await dailyMaintenance();
  return NextResponse.json(result);
}
