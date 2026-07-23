import { RRule } from "rrule";

/**
 * Recurrence rules reach the database from AI output and client drafts, and a
 * single malformed rule would break or HANG every calendar expansion (e.g.
 * FREQ=SECONDLY or INTERVAL=-1 loop for 20+ seconds inside rrule). Only rules
 * that pass this gate are ever stored:
 *  - keys whitelisted to FREQ / INTERVAL / BYDAY, values uppercased
 *  - FREQ restricted to DAILY / WEEKLY / MONTHLY
 *  - INTERVAL a positive integer (capped at 26)
 *  - BYDAY limited to the seven weekday codes
 *  - round-trip parsed and trial-expanded before acceptance
 */
export function sanitizeRrule(raw: string | null): string | null {
  if (!raw) return null;
  const parts = new Map<string, string>();
  for (const piece of raw.split(";")) {
    const [k, v] = piece.split("=").map((s) => s?.trim().toUpperCase());
    if (!k || !v) continue;
    parts.set(k, v);
  }

  const freq = parts.get("FREQ");
  if (!freq || !["DAILY", "WEEKLY", "MONTHLY"].includes(freq)) return null;

  const out: string[] = [`FREQ=${freq}`];

  const interval = parts.get("INTERVAL");
  if (interval !== undefined) {
    const n = Number(interval);
    if (!Number.isInteger(n) || n < 1 || n > 26) return null;
    if (n > 1) out.push(`INTERVAL=${n}`);
  }

  const byday = parts.get("BYDAY");
  if (byday !== undefined) {
    const valid = new Set(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
    const days = byday.split(",").map((d) => d.trim());
    if (days.length === 0 || days.some((d) => !valid.has(d))) return null;
    out.push(`BYDAY=${[...new Set(days)].join(",")}`);
  }

  const candidate = out.join(";");
  try {
    const opts = RRule.parseString(candidate);
    opts.dtstart = new Date(Date.UTC(2026, 0, 5));
    const rule = new RRule(opts);
    const probe = rule.between(
      new Date(Date.UTC(2026, 0, 1)),
      new Date(Date.UTC(2026, 1, 1)),
      true,
    );
    if (probe.length === 0 && freq !== "MONTHLY") return null;
  } catch {
    return null;
  }
  return candidate;
}
