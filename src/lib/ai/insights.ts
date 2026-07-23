/**
 * Insights engine (ARCHITECTURE §9): once a day, compose a compact context
 * and ask Claude for at most 3 action-framed suggestions. Every insight
 * leads with a one-click action from a whitelisted set — never a diagnosis.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { aiInsights, userPatterns } from "@/lib/db/schema";
import { getCalendarWindow } from "@/lib/db/queries/calendar";
import { fmtShortDay, fmtTime } from "@/lib/time";
import { priorityScore } from "@/lib/analytics/priority";
import type { UserPatterns } from "@/lib/analytics/patterns";

/** Whitelisted one-click actions — the ONLY things an insight can do. */
export const insightActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_event"),
    title: z.string().max(200),
    startLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    durationMinutes: z.number().int().min(15).max(240),
    categoryName: z.string().nullable(),
  }),
  z.object({
    type: z.literal("add_reminder"),
    eventId: z.string(),
    offsetMinutes: z.number().int().min(5).max(7 * 24 * 60),
  }),
  z.object({
    type: z.literal("reschedule_task"),
    eventId: z.string(),
    dueLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  }),
]);
export type InsightAction = z.infer<typeof insightActionSchema>;

const digestSchema = z.object({
  insights: z
    .array(
      z.object({
        kind: z.enum([
          "study_suggestion",
          "conflict",
          "starter_block_suggestion",
          "busy_week_warning",
          "schedule_improvement",
          "time_estimate",
        ]),
        title: z.string().max(120),
        body: z.string().max(400),
        confidence: z.number().min(0).max(1),
        action: insightActionSchema.nullable(),
      }),
    )
    .max(3),
});

export async function runInsightsForUser(userId: string): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) return 0;

  const now = new Date();
  const horizon = new Date(now.getTime() + 14 * 24 * 3600_000);
  const [items, patternsRow] = await Promise.all([
    getCalendarWindow(userId, now, horizon),
    db.select().from(userPatterns).where(eq(userPatterns.userId, userId)),
  ]);
  const patterns = patternsRow[0]?.patterns as UserPatterns | undefined;

  const agenda = items
    .filter((i) => i.startsAt)
    .slice(0, 60)
    .map(
      (i) =>
        `- [${i.kind}] ${fmtShortDay(i.startsAt!)} ${fmtTime(i.startsAt!)} "${i.title}"${i.categoryName ? ` (${i.categoryName})` : ""}`,
    )
    .join("\n");
  const tasks = items
    .filter((i) => i.kind === "task" && i.dueAt && !i.completed)
    .map((i) => ({ ...i, score: priorityScore({ dueAt: i.dueAt, priority: i.priority, estimatedMinutes: null, categoryName: i.categoryName }, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(
      (i) =>
        `- id=${i.id} due ${fmtShortDay(i.dueAt!)} ${fmtTime(i.dueAt!)} "${i.title}"${i.categoryName ? ` (${i.categoryName})` : ""}`,
    )
    .join("\n");

  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    system: [
      "You are the scheduling assistant inside a college student's personal productivity app.",
      "Produce AT MOST 3 insights for today's digest — fewer is better; zero is fine when nothing is genuinely useful.",
      "Every insight must lead with its concrete one-click action when one applies. Frame everything as a helpful move, never as criticism: say 'want a 25-minute starter block at 4?' — never 'you are procrastinating'.",
      "Times are America/New_York wall clock. startLocal/dueLocal use YYYY-MM-DDTHH:MM.",
      "Only propose create_event times that do not overlap the agenda below. Reference eventId values exactly as given.",
      `Today is ${fmtShortDay(now)} ${fmtTime(now)}.`,
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [
          "AGENDA (next 14 days):",
          agenda || "(empty)",
          "",
          "OPEN TASKS (priority order, with ids):",
          tasks || "(none)",
          "",
          "LEARNED PATTERNS:",
          JSON.stringify(patterns ?? {}, null, 0).slice(0, 2000),
        ].join("\n"),
      },
    ],
    output_config: { format: zodOutputFormat(digestSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) return 0;

  // Today's digest replaces yesterday's un-actioned suggestions — stale
  // advice self-deletes rather than piling into a guilt wall.
  await db
    .delete(aiInsights)
    .where(and(eq(aiInsights.userId, userId), eq(aiInsights.status, "new")));

  const expiresAt = new Date(now.getTime() + 48 * 3600_000);
  for (const insight of parsed.insights.slice(0, 3)) {
    await db.insert(aiInsights).values({
      id: crypto.randomUUID(),
      userId,
      kind: insight.kind,
      title: insight.title,
      body: insight.body,
      confidence: insight.confidence,
      action: insight.action ?? undefined,
      expiresAt,
    });
  }
  return parsed.insights.length;
}

/** Housekeeping: drop expired suggestions. */
export async function expireInsights(): Promise<void> {
  await db
    .delete(aiInsights)
    .where(and(eq(aiInsights.status, "new"), lt(aiInsights.expiresAt, new Date())));
}
