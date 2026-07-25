import { describe, expect, it } from "vitest";
import {
  adjacencyWarnings,
  freeBlocks,
  overloadRatio,
} from "@/lib/scheduling/free-time";

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 15, h, m));

describe("freeBlocks — buffer math against hand-computed days", () => {
  const window = { windowStart: at(8), windowEnd: at(22) };

  it("empty calendar → one 14-hour block", () => {
    const blocks = freeBlocks({ busy: [], ...window });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].minutes).toBe(14 * 60);
  });

  it("one class pads by 15 min each side", () => {
    const blocks = freeBlocks({
      busy: [{ startsAt: at(10), endsAt: at(11) }],
      ...window,
    });
    // 8:00–9:45 (105) and 11:15–22:00 (645)
    expect(blocks.map((b) => b.minutes)).toEqual([105, 645]);
    expect(blocks[0].end.getTime()).toBe(at(9, 45).getTime());
    expect(blocks[1].start.getTime()).toBe(at(11, 15).getTime());
  });

  it("dense day: back-to-back classes merge through their buffers", () => {
    const blocks = freeBlocks({
      busy: [
        { startsAt: at(9), endsAt: at(9, 50) },
        { startsAt: at(10), endsAt: at(10, 50) }, // 10-min gap < 2×buffer → merges
        { startsAt: at(13), endsAt: at(14, 30) },
        { startsAt: at(15), endsAt: at(16) }, // 30-min gap → also merges (15+15)
        { startsAt: at(19), endsAt: at(20) },
      ],
      ...window,
    });
    // Free: 8:00–8:45 (45), 11:05–12:45 (100), 16:15–18:45 (150), 20:15–22:00 (105)
    expect(blocks.map((b) => b.minutes)).toEqual([45, 100, 150, 105]);
  });

  it("slivers under minBlockMinutes disappear", () => {
    const blocks = freeBlocks({
      busy: [
        { startsAt: at(8, 40), endsAt: at(9) }, // leaves 8:00–8:25 (25) exactly at threshold
        { startsAt: at(9, 45), endsAt: at(22) }, // leaves 9:15–9:30 (15) → dropped
      ],
      ...window,
    });
    expect(blocks.map((b) => b.minutes)).toEqual([25]);
  });

  it("busy spilling outside the window clips cleanly", () => {
    const blocks = freeBlocks({
      busy: [
        { startsAt: at(6), endsAt: at(9) },
        { startsAt: at(21), endsAt: at(23, 30) },
      ],
      ...window,
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].start.getTime()).toBe(at(9, 15).getTime());
    expect(blocks[0].end.getTime()).toBe(at(20, 45).getTime());
  });

  it("buffer is configurable (0 = raw gaps)", () => {
    const blocks = freeBlocks({
      busy: [{ startsAt: at(10), endsAt: at(11) }],
      ...window,
      bufferMinutes: 0,
    });
    expect(blocks.map((b) => b.minutes)).toEqual([120, 660]);
  });

  it("fully-booked day → no free blocks", () => {
    expect(
      freeBlocks({ busy: [{ startsAt: at(7), endsAt: at(23) }], ...window }),
    ).toEqual([]);
  });
});

describe("adjacencyWarnings", () => {
  it("flags different-location events too close to travel between", () => {
    const w = adjacencyWarnings(
      [
        { startsAt: at(9), endsAt: at(9, 50), title: "BIO", location: "Congdon 101" },
        { startsAt: at(10), endsAt: at(10, 50), title: "CSC", location: "Couch 224" }, // 10-min gap
        { startsAt: at(11), endsAt: at(11, 50), title: "Lab", location: "Couch 224" }, // same room — fine
        { startsAt: at(14), endsAt: at(15), title: "ENG", location: "Phillips 12" }, // huge gap — fine
      ],
      15,
    );
    expect(w).toEqual([{ from: "BIO", to: "CSC", gapMinutes: 10 }]);
  });

  it("ignores unlocated events", () => {
    expect(
      adjacencyWarnings([
        { startsAt: at(9), endsAt: at(10) },
        { startsAt: at(10), endsAt: at(11) },
      ]),
    ).toEqual([]);
  });
});

describe("overloadRatio", () => {
  it("null with no work, Infinity with work but no time, ratio otherwise", () => {
    expect(overloadRatio(0, 300)).toBeNull();
    expect(overloadRatio(60, 0)).toBe(Infinity);
    expect(overloadRatio(150, 300)).toBe(0.5);
  });
});
