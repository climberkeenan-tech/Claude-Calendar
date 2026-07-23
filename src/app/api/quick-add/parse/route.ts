import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { auth } from "@/lib/auth";
import { claudeDraftSchema } from "@/lib/ai/quick-add";

export const maxDuration = 60;

/**
 * Claude reconciliation for quick add. The browser already has instant local
 * chips (chrono-node); this refines: recurrence phrasing, kind, category,
 * duration. Absent API key or on failure → 503 and the local parse stands.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ai_unavailable" }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = body?.text?.trim();
  if (!text || text.length > 500) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const tz = "America/New_York";
  const nowLocal = new Intl.DateTimeFormat("en-CA", {
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
    timeZone: tz,
  }).format(new Date());
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: tz,
  }).format(new Date());

  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      system: [
        "You convert one line of a student's natural language into a calendar draft.",
        `Current local date/time: ${weekday} ${nowLocal} (${tz}).`,
        "Rules:",
        "- 'start'/'due' are LOCAL wall-clock ISO strings without timezone suffix.",
        "- Words like 'due', 'submit', 'turn in' → kind 'task' with 'due'.",
        "- Recurring exercise/self-care ('gym every Monday') → kind 'habit' with rrule.",
        "- Recurring academic blocks ('BIO lecture every Mon/Wed') → kind 'event' with rrule.",
        "- 'next Friday' means the Friday of next week; bare weekday names mean the soonest one ahead.",
        "- Evening activities without am/pm (dinner, study, gym) default to PM.",
        "- Default duration: 60 min; classes 50 min if unstated; leave null only if truly unknowable.",
        "- Pick categoryName only from the given list; null if unclear.",
      ].join("\n"),
      messages: [{ role: "user", content: text }],
      output_config: { format: zodOutputFormat(claudeDraftSchema) },
    });
    const parsed = response.parsed_output;
    if (!parsed) {
      return NextResponse.json({ error: "parse_failed" }, { status: 502 });
    }
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({ error: "ai_unavailable" }, { status: 503 });
  }
}
