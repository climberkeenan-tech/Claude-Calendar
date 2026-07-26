import { describe, expect, it } from "vitest";
import {
  desiredJobs,
  diffJobs,
  quietHoursDeferral,
  type DesiredJob,
  type EventForJobs,
  type ExistingJob,
  type ReminderIntent,
} from "@/lib/notifications/policy";

const TZ = "America/New_York";
const now = new Date("2026-09-01T12:00:00Z"); // Tue Sep 1, 8 AM EDT

const reminder = (over: Partial<ReminderIntent> = {}): ReminderIntent => ({
  id: "rem-1",
  offsetMinutes: 60,
  absoluteAt: null,
  channels: ["push"],
  enabled: true,
  ...over,
});

const task = (over: Partial<EventForJobs> = {}): EventForJobs => ({
  id: "ev-1",
  kind: "task",
  status: "scheduled",
  startsAt: null,
  endsAt: null,
  dueAt: new Date("2026-09-03T21:00:00Z"),
  rrule: null,
  tz: TZ,
  ...over,
});

describe("desiredJobs", () => {
  it("creates one job per channel plus the always-on in-app record", () => {
    const jobs = desiredJobs(task(), [reminder({ channels: ["push", "email"] })], [], now);
    expect(jobs.map((j) => j.channel).sort()).toEqual(["email", "in_app", "push"]);
    for (const j of jobs) {
      expect(j.sendAt.toISOString()).toBe("2026-09-03T20:00:00.000Z"); // due − 60 min
    }
  });

  it("produces nothing for completed/cancelled items or past anchors", () => {
    expect(desiredJobs(task({ status: "completed" }), [reminder()], [], now)).toEqual([]);
    expect(
      desiredJobs(task({ dueAt: new Date("2026-08-31T12:00:00Z") }), [reminder()], [], now),
    ).toEqual([]);
  });

  it("skips send times already in the past even for future anchors", () => {
    // Due in 30 min, reminder offset 60 min → send time already passed.
    const soon = task({ dueAt: new Date(now.getTime() + 30 * 60000) });
    expect(desiredJobs(soon, [reminder({ offsetMinutes: 60 })], [], now)).toEqual([]);
  });

  it("expands recurring events and skips completed occurrences", () => {
    const gym: EventForJobs = {
      id: "gym",
      kind: "event",
      status: "scheduled",
      startsAt: new Date("2026-08-31T21:00:00Z"), // Mondays 5 PM EDT
      endsAt: new Date("2026-08-31T22:00:00Z"),
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dueAt: null,
      tz: TZ,
    };
    const jobs = desiredJobs(
      gym,
      [reminder({ offsetMinutes: 15, channels: [] })],
      [
        {
          occurrenceDate: "2026-09-07",
          cancelled: false,
          completed: true,
          overrides: null,
        },
      ],
      now,
      21 * 24 * 60 * 60 * 1000, // 3-week horizon
    );
    // Sep 7 completed → skipped; Sep 14 + Sep 21 remain (in_app only)
    const days = jobs.map((j) => j.occurrenceAt.toISOString().slice(0, 10));
    expect(days).toEqual(["2026-09-14", "2026-09-21"]);
    expect(jobs.every((j) => j.channel === "in_app")).toBe(true);
  });

  it("disabled reminders yield nothing", () => {
    expect(desiredJobs(task(), [reminder({ enabled: false })], [], now)).toEqual([]);
  });
});

describe("diffJobs", () => {
  const desired = desiredJobs(task(), [reminder({ channels: ["push"] })], [], now);
  const asExisting = (d: (typeof desired)[number], over: Partial<ExistingJob> = {}): ExistingJob => ({
    id: "job-1",
    reminderId: d.reminderId,
    occurrenceAt: d.occurrenceAt,
    sendAt: d.sendAt,
    channel: d.channel,
    status: "pending",
    ...over,
  });

  it("no-ops when existing matches desired", () => {
    const existing = desired.map((d) => asExisting(d));
    const { create, cancel } = diffJobs(desired, existing);
    expect(create).toEqual([]);
    expect(cancel).toEqual([]);
  });

  it("recreates jobs when the event was rescheduled", () => {
    const moved = desired.map((d) =>
      asExisting(d, { sendAt: new Date(d.sendAt.getTime() - 3 * 60 * 60 * 1000) }),
    );
    const { create, cancel } = diffJobs(desired, moved);
    expect(create.length).toBe(desired.length);
    expect(cancel.length).toBe(moved.length);
  });

  it("cancels orphans but never touches already-sent history", () => {
    const existing = [
      ...desired.map((d) => asExisting(d)),
      asExisting(desired[0], { id: "orphan", channel: "email" }),
      asExisting(desired[0], { id: "history", channel: "sms", status: "sent" }),
    ];
    const { create, cancel } = diffJobs(desired, existing);
    expect(create).toEqual([]);
    expect(cancel.map((c) => c.id)).toEqual(["orphan"]);
  });

  it("PROMISE: a quiet-hours deferred job survives every re-sync", () => {
    // Deferral rewrites sendAt to quiet-hours end; its ORIGINAL send time is
    // past, so desiredJobs no longer plans it. It must still not be dropped.
    const deferred = asExisting(desired[0], {
      id: "deferred-overnight",
      status: "deferred",
      occurrenceAt: new Date(now.getTime() - 30 * 60_000),
      sendAt: new Date(now.getTime() + 4 * 60 * 60 * 1000),
    });
    const { create, cancel } = diffJobs(desired, [...desired.map((d) => asExisting(d)), deferred], now);
    expect(cancel.map((c) => c.id)).not.toContain("deferred-overnight");
    expect(create).toEqual([]);
  });

  it("a deferred job matching a desired key is never duplicated", () => {
    const deferred = desired.map((d, i) =>
      asExisting(d, {
        id: `def-${i}`,
        status: "deferred",
        sendAt: new Date(d.sendAt.getTime() + 6 * 60 * 60 * 1000),
      }),
    );
    const { create, cancel } = diffJobs(desired, deferred, now);
    expect(create).toEqual([]);
    expect(cancel).toEqual([]);
  });

  it("SAFETY NET: a recently-missed job stays alive for the daily sweep", () => {
    const missed = asExisting(desired[0], {
      id: "missed-alarm",
      sendAt: new Date(now.getTime() - 90 * 60_000), // alarm never fired
      occurrenceAt: new Date(now.getTime() - 30 * 60_000),
    });
    const { cancel } = diffJobs(desired, [missed], now);
    expect(cancel).toEqual([]);
  });

  it("but a job overdue by more than a day is finally cancelled", () => {
    const ancient = asExisting(desired[0], {
      id: "ancient",
      sendAt: new Date(now.getTime() - 30 * 60 * 60 * 1000),
      occurrenceAt: new Date(now.getTime() - 29 * 60 * 60 * 1000),
    });
    const { cancel } = diffJobs(desired, [ancient], now);
    expect(cancel.map((c) => c.id)).toEqual(["ancient"]);
  });
});

describe("quietHoursDeferral", () => {
  const quiet = { start: "22:30", end: "07:30" };

  it("passes daytime sends through untouched", () => {
    const at = new Date("2026-09-01T18:00:00Z"); // 2 PM EDT
    expect(quietHoursDeferral(at, quiet, TZ)).toBeNull();
  });

  it("defers a 2 AM send to 7:30 AM the same morning", () => {
    const at = new Date("2026-09-02T06:00:00Z"); // 2 AM EDT
    const deferred = quietHoursDeferral(at, quiet, TZ)!;
    expect(deferred.toISOString()).toBe("2026-09-02T11:30:00.000Z"); // 7:30 EDT
  });

  it("defers a 11 PM send across midnight to next morning", () => {
    const at = new Date("2026-09-02T03:00:00Z"); // 11 PM EDT Sep 1
    const deferred = quietHoursDeferral(at, quiet, TZ)!;
    expect(deferred.toISOString()).toBe("2026-09-02T11:30:00.000Z");
  });

  it("handles a non-crossing range and unset settings", () => {
    const midday = { start: "13:00", end: "14:00" };
    const at = new Date("2026-09-01T17:30:00Z"); // 1:30 PM EDT
    expect(quietHoursDeferral(at, midday, TZ)).not.toBeNull();
    expect(quietHoursDeferral(at, { start: null, end: null }, TZ)).toBeNull();
  });
});

describe("a snooze survives the next sync", () => {
  const OCC = new Date("2026-09-18T20:00:00Z");
  const canonical = (over: Partial<DesiredJob> = {}): DesiredJob => ({
    reminderId: "r1",
    occurrenceAt: OCC,
    sendAt: new Date("2026-09-17T20:00:00Z"), // 1 day before
    channel: "push",
    ...over,
  });

  it("is never cancelled, even though its sendAt no longer matches the reminder", () => {
    // The user tapped "Tomorrow" on a fired reminder, so a job exists at a
    // time the reminder's own offset would never produce. Marked pending, the
    // next sync saw the mismatch and cancelled it — every snooze silently
    // undone, at the latest by the nightly cron. Marked deferred (which is
    // what a quiet-hours deferral already uses), it is left alone.
    const snoozed: ExistingJob = {
      id: "j-snooze",
      reminderId: "r1",
      occurrenceAt: OCC,
      channel: "push",
      sendAt: new Date("2026-09-18T13:00:00Z"), // "tomorrow 9 AM"
      status: "deferred",
    };
    const { cancel, create } = diffJobs([canonical()], [snoozed], new Date("2026-09-17T21:00:00Z"));
    expect(cancel).toHaveLength(0);
    // …and the original is NOT re-created alongside it. The snooze replaces
    // that firing; recreating it would ring at the time the user just pushed
    // away from.
    expect(create).toHaveLength(0);
  });

  it("a PENDING job with a drifted sendAt is still cancelled — that part must not change", () => {
    const drifted: ExistingJob = {
      id: "j-old",
      reminderId: "r1",
      occurrenceAt: OCC,
      channel: "push",
      sendAt: new Date("2026-09-16T20:00:00Z"), // stale, 2 days before
      status: "pending",
    };
    const { cancel } = diffJobs([canonical()], [drifted], new Date("2026-09-17T21:00:00Z"));
    expect(cancel.map((c) => c.id)).toEqual(["j-old"]);
  });

  it("the in-app companion is protected the same way", () => {
    const snoozedInApp: ExistingJob = {
      id: "j-inapp",
      reminderId: "r1",
      occurrenceAt: OCC,
      channel: "in_app",
      sendAt: new Date("2026-09-18T13:00:00Z"),
      status: "deferred",
    };
    const { cancel } = diffJobs(
      [canonical(), canonical({ channel: "in_app" })],
      [snoozedInApp],
      new Date("2026-09-17T21:00:00Z"),
    );
    expect(cancel).toHaveLength(0);
  });
});
