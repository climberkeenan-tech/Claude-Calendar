/**
 * Free/busy engine (ARCHITECTURE Phase 9, MCP §12): pure math, no I/O.
 * Shared by the plan-my-week assist, replan, the /plan page, and the MCP
 * get_free_time tool — one implementation, everywhere.
 *
 * Design rules:
 *  - Transition buffers are first-class: every busy block is padded on both
 *    sides (default 15 min) so nothing gets packed back-to-back.
 *  - Slivers below minBlockMinutes are not "free" — a 12-minute gap is a
 *    breather, not a study slot.
 */

export type BusyBlock = {
  startsAt: Date;
  endsAt: Date;
  title?: string;
  location?: string | null;
};

export type FreeBlock = { start: Date; end: Date; minutes: number };

export const DEFAULT_BUFFER_MINUTES = 15;
export const DEFAULT_MIN_BLOCK_MINUTES = 25;

const MIN = 60_000;

/** Merge overlapping/touching [start,end) intervals (epoch ms). */
function merge(intervals: { s: number; e: number }[]): { s: number; e: number }[] {
  const sorted = intervals
    .filter((i) => i.e > i.s)
    .sort((a, b) => a.s - b.s);
  const out: { s: number; e: number }[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.s <= last.e) last.e = Math.max(last.e, cur.e);
    else out.push({ ...cur });
  }
  return out;
}

/**
 * Open blocks inside [windowStart, windowEnd), after padding every busy
 * block with the transition buffer and dropping slivers.
 */
export function freeBlocks(opts: {
  busy: BusyBlock[];
  windowStart: Date;
  windowEnd: Date;
  bufferMinutes?: number;
  minBlockMinutes?: number;
}): FreeBlock[] {
  const buffer = (opts.bufferMinutes ?? DEFAULT_BUFFER_MINUTES) * MIN;
  const minLen = (opts.minBlockMinutes ?? DEFAULT_MIN_BLOCK_MINUTES) * MIN;
  const winS = opts.windowStart.getTime();
  const winE = opts.windowEnd.getTime();
  if (winE <= winS) return [];

  const padded = merge(
    opts.busy.map((b) => ({
      s: b.startsAt.getTime() - buffer,
      e: b.endsAt.getTime() + buffer,
    })),
  );

  const free: FreeBlock[] = [];
  let cursor = winS;
  for (const b of padded) {
    if (b.s > cursor) {
      const end = Math.min(b.s, winE);
      if (end - cursor >= minLen) {
        free.push({
          start: new Date(cursor),
          end: new Date(end),
          minutes: Math.round((end - cursor) / MIN),
        });
      }
    }
    cursor = Math.max(cursor, b.e);
    if (cursor >= winE) break;
  }
  if (winE - cursor >= minLen) {
    free.push({
      start: new Date(cursor),
      end: new Date(winE),
      minutes: Math.round((winE - cursor) / MIN),
    });
  }
  return free;
}

/**
 * Location-adjacency warnings: consecutive located events whose real gap is
 * smaller than the transition buffer — you physically can't be on time.
 */
export function adjacencyWarnings(
  busy: BusyBlock[],
  bufferMinutes: number = DEFAULT_BUFFER_MINUTES,
): { from: string; to: string; gapMinutes: number }[] {
  const located = busy
    .filter((b) => b.location && b.location.trim() !== "")
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const warnings: { from: string; to: string; gapMinutes: number }[] = [];
  for (let i = 0; i < located.length - 1; i++) {
    const a = located[i];
    const b = located[i + 1];
    if (a.location === b.location) continue; // same room — no travel
    const gap = (b.startsAt.getTime() - a.endsAt.getTime()) / MIN;
    if (gap >= 0 && gap < bufferMinutes) {
      warnings.push({
        from: a.title ?? "previous event",
        to: b.title ?? "next event",
        gapMinutes: Math.max(0, Math.round(gap)),
      });
    }
  }
  return warnings;
}

/**
 * Overload check for one day: open task-minutes that must happen vs free
 * minutes available. > 1 means the day physically doesn't fit.
 */
export function overloadRatio(
  taskMinutes: number,
  freeMinutes: number,
): number | null {
  if (taskMinutes <= 0) return null;
  if (freeMinutes <= 0) return Infinity;
  return taskMinutes / freeMinutes;
}
