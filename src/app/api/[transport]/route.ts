import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { and, asc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { events, focusSessions, userPatterns } from "@/lib/db/schema";
import { getCalendarWindow } from "@/lib/db/queries/calendar";
import { createItemForUser, localToInstant } from "@/lib/items/create";
import { completeItemForUser } from "@/lib/items/complete";
import { verifyBearer } from "@/lib/mcp/tokens";
import { dayBounds, fmtShortDay, fmtTime, relativeDue } from "@/lib/time";
import { syncJobsForEvent } from "@/lib/notifications/scheduler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export const maxDuration = 60;

/** "Accessible directly from Claude" (ARCHITECTURE §12): MCP over Streamable
 * HTTP, bearer-token auth (Claude Code v1; claude.ai OAuth lands Phase 11).
 * Every tool wraps the same shared cores as the UI. */

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

function userIdOf(authInfo: AuthInfo | undefined): string {
  const id = authInfo?.extra?.userId;
  if (typeof id !== "string") throw new Error("Unauthorized");
  return id;
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "get_agenda",
      "The schedule for a day (default today): timed events plus tasks due, in America/New_York time.",
      { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
      async ({ date }, { authInfo }) => {
        const userId = userIdOf(authInfo);
        const anchor = date ? new Date(`${date}T12:00:00Z`) : new Date();
        const { start, end, isoDay } = dayBounds(anchor);
        const items = await getCalendarWindow(userId, start, end);
        if (items.length === 0) return text(`${isoDay}: nothing scheduled.`);
        const lines = items
          .sort(
            (a, b) =>
              (a.startsAt ?? a.dueAt ?? new Date(0)).getTime() -
              (b.startsAt ?? b.dueAt ?? new Date(0)).getTime(),
          )
          .map((i) => {
            const when = i.startsAt
              ? fmtTime(i.startsAt)
              : i.dueAt
                ? `due ${fmtTime(i.dueAt)}`
                : "unscheduled";
            return `- ${when} · ${i.title}${i.categoryName ? ` (${i.categoryName})` : ""}${i.completed ? " ✓done" : ""} [id: ${i.id}]`;
          });
        return text(`${isoDay}:\n${lines.join("\n")}`);
      },
    );

    server.tool(
      "get_upcoming_deadlines",
      "Open tasks with due dates in the next N days (default 14), most urgent first.",
      { days: z.number().int().min(1).max(60).optional() },
      async ({ days }, { authInfo }) => {
        const userId = userIdOf(authInfo);
        const now = new Date();
        const horizon = new Date(now.getTime() + (days ?? 14) * 24 * 3600_000);
        const rows = await db
          .select({ id: events.id, title: events.title, dueAt: events.dueAt })
          .from(events)
          .where(
            and(
              eq(events.userId, userId),
              eq(events.kind, "task"),
              eq(events.status, "scheduled"),
              isNotNull(events.dueAt),
              lt(events.dueAt, horizon),
            ),
          )
          .orderBy(asc(events.dueAt));
        if (rows.length === 0) return text("No deadlines in that window.");
        return text(
          rows
            .map((r) => `- ${relativeDue(now, r.dueAt!)} · ${r.title} [id: ${r.id}]`)
            .join("\n"),
        );
      },
    );

    server.tool(
      "add_item",
      "Create an event, task (deadline), or habit. Times are America/New_York wall clock, format YYYY-MM-DDTHH:MM. Events need startLocal; tasks need dueLocal (omit for an Inbox capture). rrule supports FREQ=DAILY/WEEKLY/MONTHLY with BYDAY/INTERVAL. Categories: Classes, Homework, Exams, Personal, Work, Practice.",
      {
        title: z.string().min(1).max(300),
        kind: z.enum(["event", "task", "habit"]),
        startLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
        durationMinutes: z.number().int().min(5).max(1440).optional(),
        dueLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
        rrule: z.string().max(200).optional(),
        categoryName: z.string().optional(),
        habitTargetPerWeek: z.number().int().min(1).max(7).optional(),
      },
      async (args, { authInfo }) => {
        const userId = userIdOf(authInfo);
        const result = await createItemForUser(userId, {
          title: args.title,
          kind: args.kind,
          startLocal: args.startLocal ?? null,
          durationMinutes: args.durationMinutes ?? null,
          dueLocal: args.dueLocal ?? null,
          allDay: false,
          rrule: args.rrule ?? null,
          categoryName: args.categoryName ?? null,
          habitTargetPerWeek: args.habitTargetPerWeek ?? null,
        });
        if (!result.ok) return text(`Failed: ${result.error}`);
        return text(
          result.inbox
            ? `Captured to Inbox (no date): "${args.title}" [id: ${result.id}]`
            : `Added: "${args.title}" [id: ${result.id}]`,
        );
      },
    );

    server.tool(
      "complete_item",
      "Mark an event or task complete (or un-complete it).",
      { eventId: z.string(), completed: z.boolean().optional() },
      async ({ eventId, completed }, { authInfo }) => {
        const userId = userIdOf(authInfo);
        const r = await completeItemForUser(userId, eventId, completed ?? true);
        return text(r.ok ? `Done: "${r.title}"` : "No such item.");
      },
    );

    server.tool(
      "reschedule_task",
      "Move a task's due date/time (America/New_York wall clock).",
      {
        eventId: z.string(),
        dueLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
      },
      async ({ eventId, dueLocal }, { authInfo }) => {
        const userId = userIdOf(authInfo);
        const rows = await db
          .select({ id: events.id, kind: events.kind, title: events.title })
          .from(events)
          .where(and(eq(events.id, eventId), eq(events.userId, userId)));
        if (rows.length === 0) return text("No such item.");
        if (rows[0].kind !== "task")
          return text("Only tasks can be rescheduled this way — events move on the calendar.");
        const due = localToInstant(dueLocal);
        await db
          .update(events)
          .set({ dueAt: due, updatedAt: new Date() })
          .where(eq(events.id, eventId));
        await syncJobsForEvent(eventId);
        return text(`"${rows[0].title}" now due ${fmtShortDay(due)} ${fmtTime(due)}.`);
      },
    );

    server.tool(
      "start_focus_session",
      "Start the study timer (one session at a time).",
      { kind: z.enum(["study", "work", "reading", "other"]).optional() },
      async ({ kind }, { authInfo }) => {
        const userId = userIdOf(authInfo);
        await db
          .update(focusSessions)
          .set({ endedAt: new Date() })
          .where(and(eq(focusSessions.userId, userId), sql`${focusSessions.endedAt} is null`));
        await db.insert(focusSessions).values({
          id: crypto.randomUUID(),
          userId,
          kind: kind ?? "study",
          startedAt: new Date(),
        });
        return text(`Timer started (${kind ?? "study"}).`);
      },
    );

    server.tool(
      "stop_focus_session",
      "Stop the running study timer and save the session.",
      {},
      async (_args, { authInfo }) => {
        const userId = userIdOf(authInfo);
        const rows = await db
          .select()
          .from(focusSessions)
          .where(and(eq(focusSessions.userId, userId), sql`${focusSessions.endedAt} is null`));
        if (rows.length === 0) return text("No timer is running.");
        const now = new Date();
        for (const s of rows) {
          const minutes = Math.max(1, Math.round((now.getTime() - s.startedAt.getTime()) / 60000));
          await db
            .update(focusSessions)
            .set({ endedAt: now, durationMinutes: minutes })
            .where(eq(focusSessions.id, s.id));
        }
        return text("Timer stopped and saved.");
      },
    );

    server.tool(
      "get_productivity_summary",
      "Recent stats: focus minutes, completions, open work, learned patterns.",
      {},
      async (_args, { authInfo }) => {
        const userId = userIdOf(authInfo);
        const since = new Date(Date.now() - 7 * 24 * 3600_000);
        const [focus, completed, open, patterns] = await Promise.all([
          db
            .select({ minutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}),0)::int` })
            .from(focusSessions)
            .where(and(eq(focusSessions.userId, userId), gte(focusSessions.startedAt, since))),
          db
            .select({ n: sql<number>`count(*)::int` })
            .from(events)
            .where(
              and(
                eq(events.userId, userId),
                isNotNull(events.completedAt),
                gte(events.completedAt, since),
              ),
            ),
          db
            .select({ n: sql<number>`count(*)::int` })
            .from(events)
            .where(
              and(
                eq(events.userId, userId),
                eq(events.kind, "task"),
                eq(events.status, "scheduled"),
              ),
            ),
          db.select().from(userPatterns).where(eq(userPatterns.userId, userId)),
        ]);
        return text(
          [
            `Last 7 days: ${focus[0].minutes} focus minutes, ${completed[0].n} items completed.`,
            `Open tasks: ${open[0].n}.`,
            patterns[0]
              ? `Patterns: ${JSON.stringify(patterns[0].patterns).slice(0, 800)}`
              : "Patterns: not derived yet (first nightly run pending).",
          ].join("\n"),
        );
      },
    );
  },
  {},
  { basePath: "/api" },
);

const authedHandler = withMcpAuth(
  handler,
  async (_req, token) => {
    if (!token) return undefined;
    const userId = await verifyBearer(token);
    if (!userId) return undefined;
    return {
      token,
      clientId: "high-point-os",
      scopes: ["user"],
      extra: { userId },
    };
  },
  { required: true },
);

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
