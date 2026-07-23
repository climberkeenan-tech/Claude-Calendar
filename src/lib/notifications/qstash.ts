import { Client, Receiver } from "@upstash/qstash";

function appUrl(): string {
  return (
    process.env.APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "")
  );
}

export function qstashConfigured(): boolean {
  return Boolean(process.env.QSTASH_TOKEN && appUrl());
}

/**
 * Set the alarm for a job. Returns the QStash message id, or null when QStash
 * isn't configured (jobs then ride on the daily sweep — degraded, not broken).
 */
export async function scheduleCallback(
  body: { jobId: string; phase: "deliver" | "fallback" },
  at: Date,
): Promise<string | null> {
  if (!qstashConfigured()) return null;
  const client = new Client({ token: process.env.QSTASH_TOKEN! });
  const delaySec = Math.max(0, Math.ceil((at.getTime() - Date.now()) / 1000));
  const res = await client.publishJSON({
    url: `${appUrl()}/api/notifications/deliver`,
    body,
    delay: delaySec,
    retries: 3,
    deduplicationId: `${body.phase}-${body.jobId}-${at.getTime()}`,
  });
  return res.messageId;
}

export async function cancelCallback(messageId: string): Promise<void> {
  if (!process.env.QSTASH_TOKEN) return;
  try {
    const client = new Client({ token: process.env.QSTASH_TOKEN });
    await client.messages.delete(messageId);
  } catch {
    // Already delivered or expired — the deliver route no-ops on dead jobs.
  }
}

/** Verify a QStash signature; false when QStash isn't configured. */
export async function verifySignature(
  signature: string | null,
  body: string,
): Promise<boolean> {
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!current || !next || !signature) return false;
  try {
    const receiver = new Receiver({
      currentSigningKey: current,
      nextSigningKey: next,
    });
    return await receiver.verify({ signature, body });
  } catch {
    return false;
  }
}
