/**
 * Scopes, kept free of any database import so the rules stay unit-testable.
 *
 * Two scopes, matching what the MCP tools actually do. Anything a client asks
 * for beyond these is dropped rather than refused — a connector requesting
 * "admin" should get a working connection with the access it's entitled to,
 * not an error it can't act on.
 */
export const SCOPES = ["calendar.read", "calendar.write"] as const;
export type Scope = (typeof SCOPES)[number];
export const DEFAULT_SCOPE = SCOPES.join(" ");

export function normalizeScope(requested: string | null | undefined): string {
  if (!requested) return DEFAULT_SCOPE;
  const kept = requested
    .split(/\s+/)
    .filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
  return kept.length ? [...new Set(kept)].join(" ") : DEFAULT_SCOPE;
}
