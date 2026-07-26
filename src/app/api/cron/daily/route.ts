import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { dailyMaintenance } from "@/lib/notifications/scheduler";
import { runEscalationForUser } from "@/lib/notifications/escalation";
import { derivePatterns } from "@/lib/analytics/patterns";
import { rollupUser } from "@/lib/analytics/rollup";
import { expireInsights, runInsightsForUser } from "@/lib/ai/insights";
import { pruneOauth } from "@/lib/oauth/store";

export const maxDuration = 300;

/**
 * Daily maintenance (Vercel cron — Hobby fires this once a day at an
 * arbitrary minute within the hour; nothing time-precise lives here).
 * Stages run in order of importance so a timeout near the ceiling costs the
 * least-critical stage (insights) — each stage is independently try/caught,
 * and the Claude call comes last.
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` automatically.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const report: Record<string, unknown> = {};

  try {
    report.maintenance = await dailyMaintenance();
  } catch (err) {
    report.maintenance = `failed: ${String(err)}`;
  }

  try {
    // Expired authorization codes and long-dead tokens (Phase 11).
    await pruneOauth(new Date());
    report.oauthPrune = "ok";
  } catch (err) {
    report.oauthPrune = `failed: ${String(err)}`;
  }

  const allUsers = await db.select({ id: users.id }).from(users);
  for (const u of allUsers) {
    try {
      // Rollups feed everything downstream (patterns, insights, charts).
      report.rollup = await rollupUser(u.id);
    } catch (err) {
      report.rollup = `failed: ${String(err)}`;
    }
    try {
      await derivePatterns(u.id);
      report.patterns = "ok";
    } catch (err) {
      report.patterns = `failed: ${String(err)}`;
    }
    try {
      report.escalations = await runEscalationForUser(u.id);
    } catch (err) {
      report.escalations = `failed: ${String(err)}`;
    }
    try {
      await expireInsights();
      report.insights = await runInsightsForUser(u.id);
    } catch (err) {
      report.insights = `failed: ${String(err)}`;
    }
  }
  return NextResponse.json(report);
}

export const dynamic = "force-dynamic";
