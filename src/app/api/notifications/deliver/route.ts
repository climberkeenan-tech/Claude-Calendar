import { NextResponse } from "next/server";
import { deliverJob, pushFallback } from "@/lib/notifications/scheduler";
import { verifySignature } from "@/lib/notifications/qstash";

export const maxDuration = 60;

/**
 * QStash-signed delivery callback. Idempotent: a duplicate or late delivery
 * finds a non-pending job and no-ops. Always 200 on handled outcomes so
 * QStash doesn't retry work that was consciously skipped.
 */
export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  const signature = req.headers.get("upstash-signature");
  if (!(await verifySignature(signature, raw))) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  let body: { jobId?: string; phase?: string };
  try {
    body = JSON.parse(raw) as { jobId?: string; phase?: string };
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  if (!body.jobId) {
    return NextResponse.json({ error: "missing_job" }, { status: 400 });
  }

  const outcome =
    body.phase === "fallback"
      ? await pushFallback(body.jobId)
      : await deliverJob(body.jobId);

  // "failed" returns 500 so QStash retries with backoff; everything else is
  // settled and must not be retried.
  const status = outcome === "failed" ? 500 : 200;
  return NextResponse.json({ outcome }, { status });
}
