import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { pushSubscriptions } from "@/lib/db/schema";
import { fmtShortDay, fmtTime } from "@/lib/time";

export type DeliveryPayload = {
  jobId: string;
  userId: string;
  userEmail: string;
  title: string;
  kind: "event" | "task" | "habit";
  occurrenceAt: Date;
  location: string | null;
};

export type ChannelResult = { ok: boolean; detail?: string };

function appUrl(): string {
  return (
    process.env.APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
  );
}

function subject(p: DeliveryPayload): string {
  const when = `${fmtShortDay(p.occurrenceAt)} ${fmtTime(p.occurrenceAt)}`;
  return p.kind === "task" ? `Due ${when}: ${p.title}` : `${when}: ${p.title}`;
}

/** In-app: the job row itself IS the notification — the bell reads
 * sent-and-unacknowledged in_app jobs. Nothing to deliver externally. */
async function sendInApp(): Promise<ChannelResult> {
  return { ok: true };
}

async function sendEmail(p: DeliveryPayload): Promise<ChannelResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, detail: "email_not_configured" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      // Provider-side idempotency: a crash-retry can never double-send.
      "Idempotency-Key": `job-${p.jobId}`,
    },
    body: JSON.stringify({
      from: "High Point OS <onboarding@resend.dev>",
      to: [p.userEmail],
      subject: subject(p),
      text: [
        p.kind === "task" ? "Deadline reminder:" : "Coming up:",
        "",
        `  ${p.title}`,
        `  ${fmtShortDay(p.occurrenceAt)} at ${fmtTime(p.occurrenceAt)}`,
        p.location ? `  ${p.location}` : "",
        "",
        `Open: ${appUrl()}/`,
      ]
        .filter((l) => l !== "")
        .join("\n"),
    }),
  });
  if (!res.ok) {
    return { ok: false, detail: `resend_${res.status}` };
  }
  return { ok: true };
}

async function sendPush(p: DeliveryPayload): Promise<ChannelResult> {
  const pub = process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return { ok: false, detail: "push_not_configured" };
  webpush.setVapidDetails(`mailto:${p.userEmail}`, pub, priv);

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, p.userId));
  if (subs.length === 0) return { ok: false, detail: "no_subscriptions" };

  const body = JSON.stringify({
    title: subject(p),
    body: p.location ?? (p.kind === "task" ? "Tap to open your assignments" : "Tap to open your day"),
    jobId: p.jobId,
    url: `${appUrl()}/`,
  });

  let delivered = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        body,
        { TTL: 60 * 60, urgency: "high" },
      );
      delivered++;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // Stale subscription (browser reinstalled, permissions revoked) —
        // prune so we stop paying for dead endpoints.
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      }
    }
  }
  return delivered > 0
    ? { ok: true }
    : { ok: false, detail: "all_subscriptions_failed" };
}

/** SMS is a Phase 5 gate decision (Twilio costs per message). The interface
 * exists so enabling it later touches exactly this function. */
async function sendSms(): Promise<ChannelResult> {
  return { ok: false, detail: "sms_not_configured" };
}

export async function dispatch(
  channel: string,
  payload: DeliveryPayload,
): Promise<ChannelResult> {
  switch (channel) {
    case "in_app":
      return sendInApp();
    case "email":
      return sendEmail(payload);
    case "push":
      return sendPush(payload);
    case "sms":
      return sendSms();
    default:
      return { ok: false, detail: `unknown_channel_${channel}` };
  }
}
