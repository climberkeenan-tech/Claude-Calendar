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

  it("strips COUNT and UNTIL (they break series-splitting math)", () => {
    expect(sanitizeRrule("FREQ=WEEKLY;BYDAY=MO;COUNT=10")).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(sanitizeRrule("FREQ=WEEKLY;UNTIL=20261211T000000Z")).toBe("FREQ=WEEKLY");
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
