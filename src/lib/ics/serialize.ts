/**
 * RFC 5545 serialization primitives. Pure, no app types — the calendar feed
 * builds a tree of components and hands it here.
 *
 * The fiddly parts of iCalendar are all in this file on purpose: octet-aware
 * line folding, text escaping, and CRLF. Get one of them wrong and Google
 * silently drops the whole subscription with no error anywhere.
 */

export type IcsValue = string | number;

export type IcsProperty = {
  name: string;
  /** Parameters like TZID=America/New_York or VALUE=DATE. */
  params?: Record<string, string>;
  value: IcsValue;
  /** Text values get RFC 5545 escaping; date/time and RRULE values must not. */
  escape?: boolean;
};

export type IcsComponent = {
  name: string;
  props: IcsProperty[];
  children?: IcsComponent[];
};

/**
 * Escape a TEXT value: backslash, semicolon, comma, and newline. A comma in an
 * event title is the classic silent corruption — unescaped, it splits the
 * value into a list and the title arrives truncated.
 */
export function escapeText(raw: string): string {
  return raw
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

/** Parameter values need quoting when they contain : ; or , */
export function escapeParam(raw: string): string {
  const cleaned = raw.replace(/"/g, "");
  return /[:;,]/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

const CRLF = "\r\n";

/**
 * Fold to 75 OCTETS per line (not characters). A line of emoji or accented
 * text folded by character length blows past the limit and some parsers
 * truncate it; folding mid-codepoint corrupts it. This counts UTF-8 bytes and
 * only ever breaks between whole characters.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let bytes = 0;
  // First line gets 75 octets; continuation lines start with a space that
  // counts toward their own 75.
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 1; // the leading space on a continuation line
      limit = 75;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

function renderProp(p: IcsProperty): string {
  const params = p.params
    ? Object.entries(p.params)
        .filter(([, v]) => v !== "")
        .map(([k, v]) => `;${k}=${escapeParam(v)}`)
        .join("")
    : "";
  const value =
    p.escape === false || typeof p.value === "number"
      ? String(p.value)
      : escapeText(String(p.value));
  return foldLine(`${p.name}${params}:${value}`);
}

export function renderComponent(c: IcsComponent): string[] {
  return [
    `BEGIN:${c.name}`,
    ...c.props.map(renderProp),
    ...(c.children ?? []).flatMap(renderComponent),
    `END:${c.name}`,
  ];
}

/** Serialize a VCALENDAR. Always ends with a trailing CRLF, per spec. */
export function renderCalendar(cal: IcsComponent): string {
  return renderComponent(cal).join(CRLF) + CRLF;
}

// ---------------------------------------------------------------------------
// Date/time formatting
// ---------------------------------------------------------------------------

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** UTC form: 20260914T130000Z */
export function formatUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Floating/local form for use with a TZID param: 20260914T090000 */
export function formatLocal(wallClock: Date): string {
  return (
    `${wallClock.getUTCFullYear()}${pad(wallClock.getUTCMonth() + 1)}${pad(wallClock.getUTCDate())}` +
    `T${pad(wallClock.getUTCHours())}${pad(wallClock.getUTCMinutes())}${pad(wallClock.getUTCSeconds())}`
  );
}

/** VALUE=DATE form from a YYYY-MM-DD string: 20260914 */
export function formatDateOnly(isoDay: string): string {
  return isoDay.replace(/-/g, "");
}

/** ±HHMM, the UTC-offset form used by VTIMEZONE. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}
