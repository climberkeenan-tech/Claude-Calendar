import { describe, expect, it } from "vitest";
import { layoutDay } from "@/lib/calendar/layout";

describe("layoutDay", () => {
  it("gives non-overlapping items full width", () => {
    const boxes = layoutDay([
      { id: "a", startMin: 540, endMin: 600 },
      { id: "b", startMin: 600, endMin: 660 },
    ]);
    expect(boxes.every((b) => b.cols === 1 && b.col === 0)).toBe(true);
  });

  it("splits two overlapping items into two columns", () => {
    const boxes = layoutDay([
      { id: "a", startMin: 540, endMin: 660 },
      { id: "b", startMin: 570, endMin: 630 },
    ]);
    const [a, b] = boxes;
    expect(a.cols).toBe(2);
    expect(b.cols).toBe(2);
    expect(a.col).not.toBe(b.col);
  });

  it("keeps a transitive cluster at the max simultaneous width", () => {
    // a overlaps b, b overlaps c, but a and c don't overlap → 2 columns
    const boxes = layoutDay([
      { id: "a", startMin: 540, endMin: 610 },
      { id: "b", startMin: 600, endMin: 700 },
      { id: "c", startMin: 660, endMin: 720 },
    ]);
    expect(boxes.every((b) => b.cols === 2)).toBe(true);
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
    // c reuses a's freed column
    expect(byId["c"].col).toBe(byId["a"].col);
  });

  it("treats separate clusters independently", () => {
    const boxes = layoutDay([
      { id: "a", startMin: 540, endMin: 570 },
      { id: "b", startMin: 545, endMin: 575 },
      { id: "c", startMin: 800, endMin: 860 },
    ]);
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
    expect(byId["a"].cols).toBe(2);
    expect(byId["c"].cols).toBe(1);
  });
});
