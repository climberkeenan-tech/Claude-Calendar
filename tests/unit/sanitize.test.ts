import { describe, expect, it } from "vitest";
import { sanitizeRrule } from "@/lib/calendar/sanitize";

describe("sanitizeRrule — one bad rule must never reach the database", () => {
  it("accepts and normalizes the supported shapes", () => {
    expect(sanitizeRrule("FREQ=WEEKLY;BYDAY=MO,WE")).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
    expect(sanitizeRrule("freq=weekly;byday=mo")).toBe("FREQ=WEEKLY;BYDAY=MO"); // lowercase input
    expect(sanitizeRrule("FREQ=DAILY")).toBe("FREQ=DAILY");
    expect(sanitizeRrule("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR")).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
    );
    expect(sanitizeRrule("FREQ=MONTHLY")).toBe("FREQ=MONTHLY");
  });

  it("PRESERVES COUNT and UNTIL — a bound is meaning, not noise", () => {
    // Stripping these made every imported class recur forever, through
    // winter break and into the next year. Expansion honors both.
    expect(sanitizeRrule("FREQ=WEEKLY;BYDAY=MO;COUNT=10")).toBe(
      "FREQ=WEEKLY;BYDAY=MO;COUNT=10",
    );
    expect(sanitizeRrule("FREQ=WEEKLY;UNTIL=20261211T000000Z")).toBe(
      "FREQ=WEEKLY;UNTIL=20261211T000000Z",
    );
  });

  it("rejects everything that would crash or hang expansion", () => {
    expect(sanitizeRrule("FREQ=BOGUS")).toBeNull(); // invalid frequency
    expect(sanitizeRrule("FREQ=SECONDLY")).toBeNull(); // hang risk
    expect(sanitizeRrule("FREQ=MINUTELY")).toBeNull();
    expect(sanitizeRrule("FREQ=WEEKLY;INTERVAL=-1")).toBeNull(); // infinite loop
    expect(sanitizeRrule("FREQ=WEEKLY;INTERVAL=0")).toBeNull();
    // Empty BYDAY is dropped (safe weekly-on-anchor fallback), not stored raw
    expect(sanitizeRrule("FREQ=WEEKLY;BYDAY=")).toBe("FREQ=WEEKLY");
    expect(sanitizeRrule("FREQ=WEEKLY;BYDAY=XX")).toBeNull();
    expect(sanitizeRrule("")).toBeNull();
    expect(sanitizeRrule("garbage")).toBeNull();
    expect(sanitizeRrule(null)).toBeNull();
  });
});

describe("sanitizeRrule — bounds must survive (imported classes must END)", () => {
  it("keeps a floating UNTIL exactly as written", () => {
    expect(sanitizeRrule("FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261204T235959Z")).toBe(
      "FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261204T235959Z",
    );
  });
  it("normalizes a bare date UNTIL to end of day", () => {
    expect(sanitizeRrule("FREQ=WEEKLY;BYDAY=FR;UNTIL=20261204")).toBe(
      "FREQ=WEEKLY;BYDAY=FR;UNTIL=20261204T235959Z",
    );
  });
  it("keeps COUNT and caps runaway values", () => {
    expect(sanitizeRrule("FREQ=WEEKLY;COUNT=10")).toBe("FREQ=WEEKLY;COUNT=10");
    expect(sanitizeRrule("FREQ=DAILY;COUNT=99999")).toBeNull();
    expect(sanitizeRrule("FREQ=DAILY;COUNT=0")).toBeNull();
  });
  it("rejects malformed or impossible UNTIL values", () => {
    expect(sanitizeRrule("FREQ=WEEKLY;UNTIL=next-friday")).toBeNull();
    expect(sanitizeRrule("FREQ=WEEKLY;UNTIL=20261340T120000Z")).toBeNull();
    expect(sanitizeRrule("FREQ=WEEKLY;UNTIL=20261204T996000Z")).toBeNull();
  });
  it("a bounded rule that ends before the probe window is still valid", () => {
    // The old emptiness check would have rejected this outright.
    expect(sanitizeRrule("FREQ=WEEKLY;BYDAY=TU;UNTIL=20251215T235959Z")).toBe(
      "FREQ=WEEKLY;BYDAY=TU;UNTIL=20251215T235959Z",
    );
  });
});
