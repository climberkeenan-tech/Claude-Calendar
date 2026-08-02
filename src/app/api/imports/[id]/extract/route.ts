/**
 * Kicks off (or retries) extraction for one upload. Lives in a route rather
 * than a server action so it can claim a long function budget — Opus reading
 * a 40-page syllabus is legitimately a minutes-scale call.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { extractSyllabus } from "@/lib/ai/syllabus";

/** 60 is the Hobby-plan ceiling; asking for more fails the build rather than
 * buying more time. Enough for one syllabus. Raise to 300 on Pro. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const outcome = await extractSyllabus(id, session.userId);
  return NextResponse.json(outcome, {
    status: outcome.status === "review" ? 200 : 422,
  });
}
