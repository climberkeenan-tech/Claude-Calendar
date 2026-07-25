import { describe, expect, it } from "vitest";
import {
  chunkMinutes,
  effectiveEstimate,
  hourPreference,
  proposeBlocks,
  type PlanTask,
} from "@/lib/scheduling/plan";
import type { FreeBlock } from "@/lib/scheduling/free-time";

const at = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 8, day, h, m));
const hourOf = (d: Date) => d.getUTCHours();
const now = at(14, 8); // Sep 14, 08:00

const fb = (day: number, h1: number, h2: number): FreeBlock => ({
  start: at(day, h1),
  end: at(day, h2),
  minutes: (h2 - h1) * 60,
});

const task = (over: Partial<PlanTask>): PlanTask => ({
  id: over.id ?? "t1",
  title: over.title ?? "Task",
  dueAt: null,
  estimatedMinutes: null,
  priority: "normal",
  categoryName: null,
  ...over,
});

describe("chunking + estimates", () => {
  it("splits big estimates into 25–90 minute sittings", () => {
    expect(chunkMinutes(240)).toEqual([90, 90, 60]);
    expect(chunkMinutes(45)).toEqual([45]);
    expect(chunkMinutes(10)).toEqual([25]); // never propose sub-25 slivers
  });
  it("category defaults fill missing estimates", () => {
    expect(effectiveEstimate(task({ categoryName: "Exams" }))).toBe(120);
    expect(effectiveEstimate(task({ categoryName: "Homework" }))).toBe(60);
    expect(effectiveEstimate(task({}))).toBe(45);
  });
});

describe("proposeBlocks", () => {
  it("never overlaps existing commitments (only places inside free blocks)", () => {
    const props = proposeBlocks({
      tasks: [task({ id: "a", estimatedMinutes: 60 })],
      free: [fb(15, 10, 12)],
      now,
      hourOf,
    });
    expect(props).toHaveLength(1);
    expect(props[0].start.getTime()).toBeGreaterThanOrEqual(at(15, 10).getTime());
    expect(props[0].end.getTime()).toBeLessThanOrEqual(at(15, 12).getTime());
  });

  it("every block lands strictly before its task's due date", () => {
    const props = proposeBlocks({
      tasks: [
        task({ id: "essay", estimatedMinutes: 90, dueAt: at(16, 9) }), // due Wed 9am
      ],
      free: [fb(15, 14, 18), fb(17, 14, 18)], // Tue afternoon, Thu afternoon
      now,
      hourOf,
    });
    expect(props).toHaveLength(1);
    expect(props[0].end.getTime()).toBeLessThanOrEqual(at(16, 9).getTime());
  });

  it("higher-priority work claims the best slots first", () => {
    const props = proposeBlocks({
      tasks: [
        task({ id: "low", title: "Reading", priority: "low", estimatedMinutes: 60 }),
        task({
          id: "exam",
          title: "Midterm study",
          categoryName: "Exams",
          priority: "critical",
          dueAt: at(16, 9),
          estimatedMinutes: 90,
        }),
      ],
      free: [fb(15, 15, 17)], // ONE afternoon block, 120 min
      now,
      hourOf,
    });
    // The exam gets the slot; the reading can't fit after it + breather.
    expect(props.map((p) => p.taskId)).toEqual(["exam"]);
  });

  it("multiple chunks of one task spread with a breather between", () => {
    const props = proposeBlocks({
      tasks: [task({ id: "paper", estimatedMinutes: 180 })],
      free: [fb(15, 12, 19)],
      now,
      hourOf,
    });
    expect(props).toHaveLength(2);
    const [a, b] = props;
    expect(b.start.getTime() - a.end.getTime()).toBeGreaterThanOrEqual(15 * 60_000);
  });

  it("prefers learned focus hours when patterns exist", () => {
    const eveningFocus = Array.from({ length: 24 }, (_, h) => (h === 20 ? 100 : 0));
    const props = proposeBlocks({
      tasks: [task({ id: "hw", estimatedMinutes: 45 })],
      free: [fb(15, 9, 11), fb(15, 20, 22)],
      now,
      hourOf,
      focusByHour: eveningFocus,
    });
    expect(props[0].start.getTime()).toBe(at(15, 20).getTime());
  });

  it("a fully derailed day replans into what's left (dense reality check)", () => {
    // Three overdue-ish tasks, only two evening blocks left today + tomorrow.
    const props = proposeBlocks({
      tasks: [
        task({ id: "t1", estimatedMinutes: 50, priority: "high", dueAt: at(15, 23) }),
        task({ id: "t2", estimatedMinutes: 45, dueAt: at(16, 23) }),
        task({ id: "t3", estimatedMinutes: 30, dueAt: at(17, 23) }),
      ],
      free: [fb(14, 19, 22), fb(15, 18, 22)],
      now: at(14, 18, 30),
      hourOf,
    });
    // Everything scheduled, nothing overlaps, all before due.
    expect(props).toHaveLength(3);
    const sorted = [...props].sort((a, b) => a.start.getTime() - b.start.getTime());
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].start.getTime()).toBeGreaterThanOrEqual(
        sorted[i - 1].end.getTime(),
      );
    }
    for (const p of props) {
      const due = [at(15, 23), at(16, 23), at(17, 23)][["t1", "t2", "t3"].indexOf(p.taskId)];
      expect(p.end.getTime()).toBeLessThanOrEqual(due.getTime());
    }
  });

  it("impossible deadline yields no block (overload surfaces elsewhere, never a lie)", () => {
    const props = proposeBlocks({
      tasks: [task({ id: "x", estimatedMinutes: 60, dueAt: at(14, 9) })], // due an hour after now
      free: [fb(15, 10, 12)],
      now,
      hourOf,
    });
    expect(props).toEqual([]);
  });
});

describe("hourPreference", () => {
  it("normalizes learned patterns and falls back to student-shaped defaults", () => {
    const learned = hourPreference(Array.from({ length: 24 }, (_, h) => (h === 16 ? 50 : 0)));
    expect(learned[16]).toBe(1);
    const fallback = hourPreference(null);
    expect(fallback[16]).toBeGreaterThan(fallback[3]);
  });
});
