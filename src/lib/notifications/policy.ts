/**
 * Pure notification policy — no I/O, fully unit-tested (ARCHITECTURE §7).
 * The database is the source of truth; QStash is only the alarm clock.
 */
import { expandEvent, type OccurrenceOverride } from "@/lib/calendar/recurrence";
import { fromFloating, toFloating } from "@/lib/tz";

export const ENQUEUE_WINDOW_MS = 48 * 60 * 60 * 1000; // QStash free caps delay at 7d
export const MATERIALIZE_HORIZON_MS = 60 * 24 * 60 * 60 * 1000;
export const LEASE_MS = 2 * 60 * 1000;
export const PUSH_FALLBACK_AFTER_MS = 20 * 60 * 1000; // unacked push → email

export type ReminderIntent = {
  id: string;
  offsetMinutes: number | null;
  absoluteAt: Date | null;
  channels: string[];
  enabled: boolean;
};

export type EventForJobs = {
  id: string;
  kind: "event" | "task" | "habit";
  status: "scheduled" | "completed" | "cancelled";
  startsAt: Date | null;
  endsAt: Date | null;
  dueAt: Date | null;
  rrule: string | null;
  tz: string;
};

export type DesiredJob = {
  reminderId: string;
  occurrenceAt: Date;
  sendAt: Date;
  channel: string;
};

export type ExistingJob = {
  id: string;
  reminderId: string | null;
  occurrenceAt: Date;
  sendAt: Date;
  channel: string;
  status: string;
};

/**
 * Every reminder always produces an in-app job (the bell is the record of
 * what fired) plus the reminder's own channels.
 */
function channelsFor(reminder: ReminderIntent): string[] {
  return [...new Set(["in_app", ...reminder.channels])];
}

/** All jobs that SHOULD exist for one event within the horizon. */
export function desiredJobs(
  event: EventForJobs,
  reminders: ReminderIntent[],
  overrides: OccurrenceOverride[],
  now: Date,
  horizonMs: number = MATERIALIZE_HORIZON_MS,
): DesiredJob[] {
  if (event.status !== "scheduled") return [];
  const active = reminders.filter((r) => r.enabled);
  if (active.length === 0) return [];

  // Anchors: every future occurrence start (events/habits) or the due
  // moment (tasks) within the horizon.
  const horizonEnd = new Date(now.getTime() + horizonMs);
  const anchors: Date[] = [];
  if (event.kind === "task") {
    if (event.dueAt) anchors.push(event.dueAt);
  } else if (event.rrule && event.startsAt) {
    try {
      const occs = expandEvent(
        {
          id: event.id,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          rrule: event.rrule,
          tz: event.tz,
        },
        overrides,
        now,
        horizonEnd,
      );
      for (const o of occs) {
        if (!o.completed) anchors.push(o.startsAt);
      }
    } catch {
      // Sanitizer should make this unreachable; a bad rule yields no jobs.
    }
  } else if (event.startsAt) {
    anchors.push(event.startsAt);
  }

  const out: DesiredJob[] = [];
  for (const anchor of anchors) {
    if (anchor.getTime() <= now.getTime()) continue; // never nag about the past
    for (const r of active) {
      const sendAt = r.absoluteAt ?? new Date(anchor.getTime() - (r.offsetMinutes ?? 0) * 60000);
      if (sendAt.getTime() <= now.getTime()) continue;
      if (sendAt.getTime() > horizonEnd.getTime()) continue;
      for (const channel of channelsFor(r)) {
        out.push({ reminderId: r.id, occurrenceAt: anchor, sendAt, channel });
      }
    }
  }
  return out;
}

const key = (j: { reminderId: string | null; occurrenceAt: Date; channel: string }) =>
  `${j.reminderId}|${j.occurrenceAt.toISOString()}|${j.channel}`;

/**
 * Diff desired vs existing. Only pending/deferred jobs are cancellable —
 * anything already sent/acknowledged is history and must be left alone.
 */
export function diffJobs(
  desired: DesiredJob[],
  existing: ExistingJob[],
): { create: DesiredJob[]; cancel: ExistingJob[] } {
  const desiredByKey = new Map(desired.map((d) => [key(d), d]));
  const liveExisting = existing.filter(
    (e) => e.status === "pending" || e.status === "deferred" || e.status === "sending",
  );
  const existingByKey = new Map(liveExisting.map((e) => [key(e), e]));

  const create: DesiredJob[] = [];
  for (const d of desired) {
    const match = existingByKey.get(key(d));
    if (!match || Math.abs(match.sendAt.getTime() - d.sendAt.getTime()) > 60_000) {
      if (!match) create.push(d);
      else {
        // send time moved (event rescheduled or offset changed): recreate
        create.push(d);
      }
    }
  }
  const cancel: ExistingJob[] = [];
  for (const e of liveExisting) {
    const match = desiredByKey.get(key(e));
    if (!match || Math.abs(match.sendAt.getTime() - e.sendAt.getTime()) > 60_000) {
      cancel.push(e);
    }
  }
  return { create, cancel };
}

/** Jobs due inside the QStash window that still need an alarm set. */
export function needsEnqueue(
  jobs: { sendAt: Date; status: string; qstashMessageId: string | null }[],
  now: Date,
): boolean[] {
  return jobs.map(
    (j) =>
      j.status === "pending" &&
      j.qstashMessageId === null &&
      j.sendAt.getTime() <= now.getTime() + ENQUEUE_WINDOW_MS,
  );
}

export type QuietHours = { start: string | null; end: string | null };

/**
 * Quiet hours defer, never drop. Returns null when `at` is outside quiet
 * hours; otherwise the instant quiet hours end (handles ranges that cross
 * midnight, e.g. 22:30 → 07:30).
 */
export function quietHoursDeferral(
  at: Date,
  quiet: QuietHours,
  tz: string,
): Date | null {
  if (!quiet.start || !quiet.end || quiet.start === quiet.end) return null;
  const f = toFloating(at, tz);
  const minutes = f.getUTCHours() * 60 + f.getUTCMinutes();
  const [sh, sm] = quiet.start.split(":").map(Number);
  const [eh, em] = quiet.end.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  const crossesMidnight = startMin > endMin;
  const inQuiet = crossesMidnight
    ? minutes >= startMin || minutes < endMin
    : minutes >= startMin && minutes < endMin;
  if (!inQuiet) return null;

  const dayIso = f.toISOString().slice(0, 10);
  const endToday = new Date(
    `${dayIso}T${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}:00Z`,
  );
  let endFloating = endToday;
  if (crossesMidnight && minutes >= startMin) {
    // In the pre-midnight leg — quiet ends tomorrow morning.
    endFloating = new Date(endToday.getTime() + 24 * 60 * 60 * 1000);
  }
  return fromFloating(endFloating, tz);
}
