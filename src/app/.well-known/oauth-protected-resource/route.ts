import { issuerFor, JSON_HEADERS, MCP_RESOURCE_PATH } from "@/lib/oauth/metadata";

/**
 * RFC 9728 — points a client at the authorization server for this resource.
 * The MCP spec has clients try the resource-specific path first and fall back
 * to the root, so both are served (see ./[...path]/route.ts).
 */
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const issuer = issuerFor(req);
  return Response.json(
    {
      resource: `${issuer}${MCP_RESOURCE_PATH}`,
      authorization_servers: [issuer],
      scopes_supported: ["calendar.read", "calendar.write"],
      bearer_methods_supported: ["header"],
      resource_documentation: `${issuer}/settings`,
    },
    { headers: JSON_HEADERS },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}
