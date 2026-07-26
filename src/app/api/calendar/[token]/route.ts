import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { userSettings, users } from "@/lib/db/schema";
import { getFeedRows } from "@/lib/db/queries/feed";
import { buildFeed } from "@/lib/ics/feed";
import { renderCalendar } from "@/lib/ics/serialize";

/**
 * The read-only ICS subscription feed (Phase 11).
 *
 * Deliberately NOT behind the session: Google, Apple, and Outlook fetch this
 * from their own servers with no cookies and no way to send a header, so the
 * capability has to live in the URL. The token is 32 random bytes, the
 * response is uncacheable by shared proxies, and rotating the token in
 * Settings breaks every existing subscription instantly.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function notFound() {
  // Same response for "no such token" and "malformed" — a subscription URL
  // shouldn't confirm which tokens exist.
  return new Response("Not found", { status: 404 });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || !/^feed_[a-f0-9]{48,}$/.test(token)) return notFound();

  const rows = await db
    .select({ userId: userSettings.userId, name: users.name, email: users.email })
    .from(userSettings)
    .innerJoin(users, eq(userSettings.userId, users.id))
    .where(eq(userSettings.calendarFeedToken, token))
    .limit(1);
  if (rows.length === 0) return notFound();

  const { userId, name } = rows[0];
  const now = new Date();
  const { events, occurrencesByEvent } = await getFeedRows(userId, now);

  const body = renderCalendar(
    buildFeed({
      events,
      occurrencesByEvent,
      domain: new URL(req.url).host,
      calendarName: name ? `${name} — High Point OS` : "High Point OS",
      now,
    }),
  );

  // A weak ETag over the content lets a polling client skip the transfer;
  // DTSTAMP moves every request, so it's hashed over the body minus those.
  const etag = `W/"${createHash("sha256")
    .update(body.replace(/DTSTAMP:[0-9TZ]+/g, ""))
    .digest("hex")
    .slice(0, 32)}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="high-point-os.ics"',
      ETag: etag,
      // private: the URL is a bearer credential, so no shared cache may keep
      // a copy. max-age matches the REFRESH-INTERVAL advertised in the file.
      "Cache-Control": "private, max-age=3600",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
