import { describe, expect, it } from "vitest";
import {
  expandEvent,
  untilBefore,
  withUntil,
  type SeriesEvent,
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
