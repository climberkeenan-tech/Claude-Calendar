import { RRule } from "rrule";

/**
 * Recurrence rules reach the database from AI output and client drafts, and a
 * single malformed rule would break or HANG every calendar expansion (e.g.
 * FREQ=SECONDLY or INTERVAL=-1 loop for 20+ seconds inside rrule). Only rules
 * that pass this gate are ever stored:
 *  - keys whitelisted to FREQ / INTERVAL / BYDAY / UNTIL / COUNT
 *  - FREQ restricted to DAILY / WEEKLY / MONTHLY
 *  - INTERVAL a positive integer (capped at 26)
 *  - BYDAY limited to the seven weekday codes
 *  - UNTIL in this codebase's floating encoding (YYYYMMDDTHHMMSSZ, or a bare
 *    YYYYMMDD normalized to end-of-day); COUNT a positive integer ≤ 366
 *  - round-trip parsed and trial-expanded before acceptance
 *
 * UNTIL/COUNT are BOUNDS, and dropping them is never safe: a syllabus class
 * bounded at the last day of term would otherwise recur through winter break
 * and into next year.
 */
export function sanitizeRrule(raw: string | null): string | null {
  if (!raw) return null;
  // Accept the full property line as well as the bare body. Models emit
  // "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR" at least as readily as the body the
  // prompt asks for, and splitting that on ";" then "=" produced the key
  // "RRULE:FREQ" — FREQ came back undefined and the entire rule was dropped.
  // A syllabus import then turned a semester of classes into one meeting.
  const body = raw.trim().replace(/^RRULE:/i, "");
  const parts = new Map<string, string>();
  for (const piece of body.split(";")) {
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

  // A bound makes the trial expansion window meaningless (a rule ending
  // before the probe window is valid, just finished) — track it and relax
  // the emptiness check accordingly.
  let bounded = false;

  const until = parts.get("UNTIL");
  if (until !== undefined) {
    // The RFC wants the compact form, but the expanded ISO one
    // ("2026-12-04T23:59:59Z") is just as common from a model and means
    // exactly the same instant — normalize rather than reject.
    const compact = /^(\d{8})(?:T(\d{6})Z?)?$/.exec(until.replace(/[-:]/g, ""));
    if (!compact) return null;
    const [, ymd, hms] = compact;
    const y = Number(ymd.slice(0, 4));
    const mo = Number(ymd.slice(4, 6));
    const d = Number(ymd.slice(6, 8));
    const time = hms ?? "235959";
    const hh = Number(time.slice(0, 2));
    const mi = Number(time.slice(2, 4));
    const ss = Number(time.slice(4, 6));
    const probe = new Date(Date.UTC(y, mo - 1, d, hh, mi, ss));
    if (
      Number.isNaN(probe.getTime()) ||
      probe.getUTCFullYear() !== y ||
      probe.getUTCMonth() !== mo - 1 ||
      probe.getUTCDate() !== d ||
      hh > 23 ||
      mi > 59 ||
      ss > 59
    ) {
      return null;
    }
    out.push(`UNTIL=${ymd}T${time}Z`);
    bounded = true;
  }

  const count = parts.get("COUNT");
  if (count !== undefined) {
    const n = Number(count);
    // Capped so a bounded rule can never become an expansion hazard.
    if (!Number.isInteger(n) || n < 1 || n > 366) return null;
    out.push(`COUNT=${n}`);
    bounded = true;
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
    // An unbounded rule that generates nothing in a whole month is broken;
    // a bounded one may simply end before the fixed probe window.
    if (probe.length === 0 && freq !== "MONTHLY" && !bounded) return null;
  } catch {
    return null;
  }
  return candidate;
}
