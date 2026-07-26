import { authorizationServerMetadata, issuerFor, JSON_HEADERS } from "@/lib/oauth/metadata";

/** RFC 8414 — the document a custom connector reads before doing anything. */
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return Response.json(authorizationServerMetadata(issuerFor(req)), {
    headers: JSON_HEADERS,
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}
