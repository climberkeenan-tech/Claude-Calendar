import { getPublicOrigin } from "mcp-handler";

/**
 * Where this server lives, from the request's own public origin. Hardcoding
 * APP_URL would break preview deployments and localhost; deriving it means the
 * issuer in the metadata always matches the host the client actually reached.
 */
export function issuerFor(req: Request): string {
  return getPublicOrigin(req);
}

export const MCP_RESOURCE_PATH = "/api/mcp";

export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    scopes_supported: ["calendar.read", "calendar.write"],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // Public clients only: a connector running in someone's browser or desktop
    // app has nowhere to keep a secret, which is exactly what PKCE replaces.
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    service_documentation: `${issuer}/settings`,
  };
}

export const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=3600",
  // MCP clients running in a browser fetch this cross-origin.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
} as const;
