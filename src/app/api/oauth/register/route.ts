import { z } from "zod";
import { isAllowedRedirectUri } from "@/lib/oauth/pkce";
import { normalizeScope, registerClient } from "@/lib/oauth/store";
import { JSON_HEADERS } from "@/lib/oauth/metadata";

/**
 * RFC 7591 Dynamic Client Registration.
 *
 * Open by necessity — claude.ai registers itself the moment you add the
 * connector, with no chance to pre-share a client_id. What keeps that safe is
 * that registration alone grants nothing: every client still has to send the
 * user through /authorize, where a real Google session on the allowlist is the
 * only thing that can approve it.
 */
export const dynamic = "force-dynamic";

const schema = z.object({
  // Length-capped per entry, not just per array. Registration is open by
  // necessity, so an uncapped string is an invitation to store megabytes per
  // request; a real redirect URI is well under 200 characters.
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  client_name: z.string().max(200).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().max(500).optional(),
  token_endpoint_auth_method: z.string().optional(),
});

function error(code: string, description: string, status = 400) {
  return Response.json(
    { error: code, error_description: description },
    { status, headers: { ...JSON_HEADERS, "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error("invalid_client_metadata", "Body must be JSON.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Say which field and why. A fixed "redirect_uris is required" was a lie
    // for every other way this can fail — an over-long URI, too many of them,
    // a client_name past the cap — and left an integrator with nothing to act
    // on but a guess.
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? issue.path.join(".") : "request body";
    return error(
      "invalid_client_metadata",
      `${where}: ${issue?.message ?? "invalid client metadata"}`,
    );
  }
  const v = parsed.data;

  const bad = v.redirect_uris.filter((u) => !isAllowedRedirectUri(u));
  if (bad.length > 0) {
    return error(
      "invalid_redirect_uri",
      `Redirect URIs must be https (or http on loopback) with no fragment: ${bad.join(", ")}`,
    );
  }

  // This server only implements the code flow; anything else would be a lie
  // in the metadata the client caches.
  const grants = (v.grant_types ?? ["authorization_code", "refresh_token"]).filter((g) =>
    ["authorization_code", "refresh_token"].includes(g),
  );
  if (grants.length === 0) {
    return error(
      "invalid_client_metadata",
      "Only authorization_code and refresh_token are supported.",
    );
  }
  if (v.token_endpoint_auth_method && v.token_endpoint_auth_method !== "none") {
    return error(
      "invalid_client_metadata",
      "Only public clients (token_endpoint_auth_method=none) are supported.",
    );
  }

  const scope = normalizeScope(v.scope);
  const clientId = await registerClient({
    clientName: v.client_name ?? null,
    redirectUris: v.redirect_uris,
    grantTypes: grants,
    scope,
  });

  return Response.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: v.redirect_uris,
      grant_types: grants,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_name: v.client_name ?? "MCP client",
      scope,
    },
    { status: 201, headers: { ...JSON_HEADERS, "Cache-Control": "no-store" } },
  );
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...JSON_HEADERS,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}
