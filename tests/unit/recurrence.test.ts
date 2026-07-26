import { describe, expect, it } from "vitest";
import {
  carryUntil,
  expandEvent,
  type SeriesEvent,
  untilBefore,
  withUntil,
} from "@/lib/calendar/recurrence";
import { fromFloating, toFloating, wallClockToInstant } from "@/lib/tz";

const TZ = "America/New_York";

// Monday 2026-02-02 17:00 EST (UTC-5) = 22:00Z, one-hour event
const mondayGym: SeriesEvent = {
  id: "gym",
  startsAt: new Date("2026-02-02T22:00:00Z"),
  endsAt: new Date("2026-02-02T23:00:00Z"),
  rrule: "FREQ=WEEKLY;BYDAY=MO",
  tz: TZ,
};

describe("floating time conversion", () => {
  it("round-trips across both DST offsets", () => {
    for (const iso of ["2026-01-10T15:30:00Z", "2026-07-10T15:30:00Z"]) {
      const instant = new Date(iso);
      expect(fromFloating(toFloating(instant, TZ), TZ).toISOString()).toBe(
        instant.toISOString(),
      );
    }
  });
  it("wallClockToInstant honors EST vs EDT", () => {
    expect(wallClockToInstant("2026-02-02", "17:00", TZ).toISOString()).toBe(
      "2026-02-02T22:00:00.000Z", // UTC-5
    );
    expect(wallClockToInstant("2026-07-06", "17:00", TZ).toISOString()).toBe(
      "2026-07-06T21:00:00.000Z", // UTC-4
    );
  });
});

describe("expandEvent — weekly across the spring DST boundary (Mar 8, 2026)", () => {
  it("keeps 5 PM local: 22:00Z before, 21:00Z after", () => {
    const occ = expandEvent(
      mondayGym,
      [],
      new Date("2026-03-01T00:00:00Z"),
      new Date("2026-03-20T00:00:00Z"),
    );
    const isos = occ.map((o) => o.startsAt.toISOString());
    expect(isos).toEqual([
      "2026-03-02T22:00:00.000Z", // Mon Mar 2, EST
      "2026-03-09T21:00:00.000Z", // Mon Mar 9, EDT — same 5 PM wall clock
      "2026-03-16T21:00:00.000Z",
    ]);
    // Duration preserved (1 h)
    expect(
      occ.every(
        (o) => o.endsAt!.getTime() - o.startsAt.getTime() === 60 * 60 * 1000,
      ),
    ).toBe(true);
  });

  it("keeps 5 PM local across the fall-back boundary (Nov 1, 2026)", () => {
    const occ = expandEvent(
      mondayGym,
      [],
      new Date("2026-10-25T00:00:00Z"),
      new Date("2026-11-10T00:00:00Z"),
    );
    const isos = occ.map((o) => o.startsAt.toISOString());
    expect(isos).toEqual([
      "2026-10-26T21:00:00.000Z", // EDT
      "2026-11-02T22:00:00.000Z", // EST again
      "2026-11-09T22:00:00.000Z",
    ]);
  });
});

describe("expandEvent — overrides", () => {
  it("drops cancelled occurrences and applies time overrides", () => {
    const occ = expandEvent(
      mondayGym,
      [
        {
          occurrenceDate: "2026-02-09",
          cancelled: true,
          completed: false,
          overrides: null,
        },
        {
          occurrenceDate: "2026-02-16",
          cancelled: false,
          completed: true,
          overrides: {
            startsAt: "2026-02-16T23:30:00.000Z",
            endsAt: "2026-02-17T00:30:00.000Z",
          },
        },
      ],
      new Date("2026-02-01T00:00:00Z"),
      new Date("2026-02-23T00:00:00Z"),
    );
    const byDate = Object.fromEntries(occ.map((o) => [o.occurrenceDate, o]));
    expect(byDate["2026-02-09"]).toBeUndefined();
    expect(byDate["2026-02-16"].startsAt.toISOString()).toBe(
      "2026-02-16T23:30:00.000Z",
    );
    expect(byDate["2026-02-16"].completed).toBe(true);
    expect(byDate["2026-02-02"].overridden).toBe(false);
  });
});

describe("regressions from adversarial review", () => {
  it("nonexistent spring-forward wall clock shifts FORWARD (2:30 → 3:30 EDT)", () => {
    // 2:30 AM doesn't exist on 2026-03-08 in New York; convention: shift
    // forward across the gap, never render an earlier hour.
    const instant = wallClockToInstant("2026-03-08", "02:30", TZ);
    expect(instant.toISOString()).toBe("2026-03-08T07:30:00.000Z"); // 3:30 EDT
  });

  it("an occurrence moved into a window is returned by that window", () => {
    // Feb 16 (Mon) occurrence moved to Feb 24 (Tue) — expanding the week of
    // Feb 23 must include it, keyed to its original date.
    const occ = expandEvent(
      mondayGym,
      [
        {
          occurrenceDate: "2026-02-16",
          cancelled: false,
          completed: false,
          overrides: {
            startsAt: "2026-02-24T22:00:00.000Z",
            endsAt: "2026-02-24T23:00:00.000Z",
          },
        },
      ],
      new Date("2026-02-23T00:00:00Z"),
      new Date("2026-03-02T00:00:00Z"),
    );
    const dates = occ.map((o) => o.occurrenceDate);
    expect(dates).toContain("2026-02-16"); // the moved one
    expect(dates).toContain("2026-02-23"); // the regular Monday
    // ...and the window it left no longer shows it
    const oldWeek = expandEvent(
      mondayGym,
      [
        {
          occurrenceDate: "2026-02-16",
          cancelled: false,
          completed: false,
          overrides: {
            startsAt: "2026-02-24T22:00:00.000Z",
            endsAt: "2026-02-24T23:00:00.000Z",
          },
        },
      ],
      new Date("2026-02-16T00:00:00Z"),
      new Date("2026-02-23T00:00:00Z"),
    );
    expect(oldWeek.map((o) => o.occurrenceDate)).not.toContain("2026-02-16");
  });

  it("a multi-day occurrence straddling windowStart is included", () => {
    // Weekly Friday 5 PM → Monday 9 AM (64 h). A window opening Sunday must
    // still show the in-progress occurrence that started Friday.
    const longEvent: SeriesEvent = {
      id: "trip",
      startsAt: new Date("2026-02-06T22:00:00Z"), // Fri 5 PM EST
      endsAt: new Date("2026-02-09T14:00:00Z"), // Mon 9 AM EST
      rrule: "FREQ=WEEKLY;BYDAY=FR",
      tz: TZ,
    };
    const occ = expandEvent(
      longEvent,
      [],
      new Date("2026-02-08T05:00:00Z"), // Sunday midnight EST
      new Date("2026-02-09T05:00:00Z"),
    );
    expect(occ.map((o) => o.occurrenceDate)).toContain("2026-02-06");
  });
});

describe("expandEvent — non-recurring", () => {
  it("returns the event only when it intersects the window", () => {
    const single: SeriesEvent = {
      id: "x",
      startsAt: new Date("2026-02-05T15:00:00Z"),
      endsAt: new Date("2026-02-05T16:00:00Z"),
      rrule: null,
      tz: TZ,
    };
    expect(
      expandEvent(single, [], new Date("2026-02-05T00:00:00Z"), new Date("2026-02-06T00:00:00Z")),
    ).toHaveLength(1);
    expect(
      expandEvent(single, [], new Date("2026-02-06T00:00:00Z"), new Date("2026-02-07T00:00:00Z")),
    ).toHaveLength(0);
  });
});

describe("this-and-future split (untilBefore + withUntil)", () => {
  it("keeps every occurrence strictly before the split and none after", () => {
    const splitStart = new Date("2026-03-09T21:00:00Z"); // the Mar 9 occurrence
    const until = untilBefore(mondayGym, splitStart);
    expect(until).toBe("20260302T170000Z"); // floating 5 PM of the last kept Monday
    const trimmed: SeriesEvent = {
      ...mondayGym,
      rrule: withUntil(mondayGym.rrule!, until!),
    };
    const occ = expandEvent(
      trimmed,
      [],
      new Date("2026-02-01T00:00:00Z"),
      new Date("2026-05-01T00:00:00Z"),
    );
    const last = occ[occ.length - 1];
    expect(last.startsAt.toISOString()).toBe("2026-03-02T22:00:00.000Z");
    // The final kept day is NOT silently dropped (the UNTIL-at-UTC-midnight bug)
    expect(occ.map((o) => o.occurrenceDate)).toContain("2026-03-02");
  });

  it("returns null when the split precedes the first occurrence", () => {
    expect(untilBefore(mondayGym, new Date("2026-02-02T22:00:00Z"))).toBeNull();
  });
});

describe("carryUntil — the bound survives a this-and-future split", () => {
  const TZ = "America/New_York";
  // Every syllabus-imported class is bounded at term end (lib/import/map.ts).
  const CLASS = "FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261211T235959Z";

  const meetings = (rrule: string, start: Date) =>
    expandEvent(
      { id: "x", startsAt: start, endsAt: new Date(start.getTime() + 50 * 60000), rrule, tz: TZ },
      [],
      new Date("2026-10-01T00:00:00Z"),
      new Date("2027-12-31T00:00:00Z"),
    ).length;

  it("keeps the term bound when the split stays inside the term", () => {
    const newStart = wallClockToInstant("2026-10-06", "10:00", TZ);
    expect(carryUntil(CLASS, newStart, TZ)).toBe(CLASS);
    // Dropping UNTIL here turned 29 real meetings into 193 — a class that
    // never ended, on every calendar it was ever exported to.
    expect(meetings(carryUntil(CLASS, newStart, TZ), newStart)).toBe(29);
    expect(meetings(CLASS.replace(";UNTIL=20261211T235959Z", ""), newStart)).toBeGreaterThan(150);
  });

  it("extends the bound only far enough to keep an occurrence moved past it", () => {
    const late = wallClockToInstant("2027-02-01", "10:00", TZ);
    const carried = carryUntil(CLASS, late, TZ);
    expect(carried).not.toBe(CLASS);
    expect(carried).toContain("UNTIL=20270201T100000Z");
    // The occurrence the user just moved must survive, and nothing beyond it.
    expect(meetings(carried, late)).toBe(1);
    expect(meetings(CLASS, late)).toBe(0); // what an unchanged bound would give
  });

  it("leaves an unbounded series unbounded", () => {
    const open = "FREQ=WEEKLY;BYDAY=MO";
    expect(carryUntil(open, wallClockToInstant("2026-10-06", "10:00", TZ), TZ)).toBe(open);
  });
});

describe("endsAt is EXCLUSIVE at the window boundary", () => {
  // An all-day event runs to the NEXT local midnight, which IS the next day's
  // window start. `end >= windowStart` therefore counted yesterday's all-day
  // event as part of today. Every UI surface re-buckets by day and hid it, but
  // MCP get_agenda reads this directly — asking Claude "what's on today"
  // listed yesterday's holiday.
  const at = (d: string, t: string) => wallClockToInstant(d, t, TZ);
  const today = at("2026-09-15", "00:00");
  const tomorrow = at("2026-09-16", "00:00");
  const count = (e: SeriesEvent) => expandEvent(e, [], today, tomorrow).length;

  it("excludes an event that ENDS exactly when the window opens", () => {
    expect(
      count({
        id: "yesterday",
        startsAt: at("2026-09-14", "00:00"),
        endsAt: today,
        rrule: null,
        tz: TZ,
      }),
    ).toBe(0);
    // Same boundary, reached through the recurring path.
    expect(
      count({
        id: "weekly",
        startsAt: at("2026-09-08", "00:00"),
        endsAt: at("2026-09-09", "00:00"),
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        tz: TZ,
      }),
    ).toBe(0);
  });

  it("still includes everything that genuinely overlaps", () => {
    // Today's own all-day event.
    expect(
      count({ id: "today", startsAt: today, endsAt: tomorrow, rrule: null, tz: TZ }),
    ).toBe(1);
    // A meeting that started last night and is still running.
    expect(
      count({
        id: "overnight",
        startsAt: at("2026-09-14", "23:00"),
        endsAt: at("2026-09-15", "01:00"),
        rrule: null,
        tz: TZ,
      }),
    ).toBe(1);
  });

  it("keeps a zero-duration item sitting exactly on the boundary", () => {
    // endsAt null means end === start, so a bare `end > windowStart` would
    // drop this one. The second clause of overlaps() exists for it.
    expect(
      count({ id: "midnight", startsAt: today, endsAt: null, rrule: null, tz: TZ }),
    ).toBe(1);
  });
});
