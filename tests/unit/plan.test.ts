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
const dayKeyOf = (d: Date) => d.toISOString().slice(0, 10);
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
      dayKeyOf,
    }).proposals;
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
      dayKeyOf,
    }).proposals;
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
      dayKeyOf,
    }).proposals;
    // The exam gets the slot; the reading can't fit after it + breather.
    expect(props.map((p) => p.taskId)).toEqual(["exam"]);
  });

  it("multiple chunks of one task spread with a breather between", () => {
    const props = proposeBlocks({
      tasks: [task({ id: "paper", estimatedMinutes: 180 })],
      free: [fb(15, 12, 19)],
      now,
      hourOf,
      dayKeyOf,
    }).proposals;
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
      dayKeyOf,
      focusByHour: eveningFocus,
    }).proposals;
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
      dayKeyOf,
    }).proposals;
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
      dayKeyOf,
    }).proposals;
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

describe("proposeBlocks — the quality rules that make Accept trustworthy", () => {
  it("re-planning tops up instead of double-booking what's already planned", () => {
    const already = proposeBlocks({
      tasks: [task({ id: "paper", estimatedMinutes: 180, plannedMinutes: 180 })],
      free: [fb(15, 12, 20)],
      now,
      hourOf,
      dayKeyOf,
    });
    expect(already.proposals).toEqual([]);
    expect(already.unplaceable[0].reason).toBe("already_planned");

    const partial = proposeBlocks({
      tasks: [task({ id: "paper", estimatedMinutes: 180, plannedMinutes: 90 })],
      free: [fb(15, 12, 20)],
      now,
      hourOf,
      dayKeyOf,
    });
    // Only the remaining 90 minutes get scheduled.
    expect(partial.proposals.reduce((a, p) => a + p.minutes, 0)).toBe(90);
  });

  it("spreads a long task across days instead of cramming one evening", () => {
    const { proposals } = proposeBlocks({
      tasks: [task({ id: "thesis", estimatedMinutes: 180 })],
      free: [fb(15, 12, 20), fb(16, 12, 20)],
      now,
      hourOf,
      dayKeyOf,
    });
    const days = new Set(proposals.map((p) => dayKeyOf(p.start)));
    expect(proposals).toHaveLength(2);
    expect(days.size).toBe(2);
  });

  it("honors the per-day ceiling and says which days filled up", () => {
    const { proposals, unplaceable } = proposeBlocks({
      tasks: [
        task({ id: "a", estimatedMinutes: 90, dueAt: at(16, 9) }),
        task({ id: "b", estimatedMinutes: 90, dueAt: at(16, 9) }),
      ],
      free: [fb(15, 9, 20)], // plenty of room…
      now,
      hourOf,
      dayKeyOf,
      maxPerDayMinutes: 90, // …but only 90 minutes may be planned that day
    });
    expect(proposals.reduce((a, p) => a + p.minutes, 0)).toBe(90);
    expect(unplaceable[0].reason).toBe("day_caps_reached");
    expect(unplaceable[0].missingMinutes).toBe(90);
  });

  it("respects minutes already planned on a day from earlier accepts", () => {
    const { proposals } = proposeBlocks({
      tasks: [task({ id: "a", estimatedMinutes: 90 })],
      free: [fb(15, 9, 20)],
      now,
      hourOf,
      dayKeyOf,
      maxPerDayMinutes: 120,
      existingPerDay: { "2026-09-15": 60 }, // only 60 left
    });
    expect(proposals).toEqual([]);
  });

  it("never proposes an ambush block starting in the next few minutes", () => {
    const { proposals } = proposeBlocks({
      tasks: [task({ id: "a", estimatedMinutes: 30 })],
      free: [{ start: at(14, 8, 5), end: at(14, 12), minutes: 235 }],
      now: at(14, 8),
      hourOf,
      dayKeyOf,
      minLeadMinutes: 30,
    });
    expect(proposals[0].start.getTime()).toBeGreaterThanOrEqual(at(14, 8, 30).getTime());
  });

  it("uses the configured buffer between a task's own sittings", () => {
    const { proposals } = proposeBlocks({
      tasks: [task({ id: "p", estimatedMinutes: 180 })],
      free: [fb(15, 12, 19)],
      now,
      hourOf,
      dayKeyOf,
      bufferMinutes: 45,
    });
    expect(proposals[1].start.getTime() - proposals[0].end.getTime()).toBeGreaterThanOrEqual(
      45 * 60_000,
    );
  });

  it("says so when an estimate is too big for one plan (never silently truncates)", () => {
    const { truncated } = proposeBlocks({
      tasks: [task({ id: "huge", estimatedMinutes: 600 })], // 7 chunks
      free: [fb(15, 8, 22), fb(16, 8, 22), fb(17, 8, 22)],
      now,
      hourOf,
      dayKeyOf,
      maxBlocksPerTask: 4,
      maxPerDayMinutes: 600,
    });
    expect(truncated).toHaveLength(1);
    expect(truncated[0].taskId).toBe("huge");
  });

  it("distinguishes 'no time before due' from 'no free time at all'", () => {
    const noRoom = proposeBlocks({
      tasks: [task({ id: "x", estimatedMinutes: 60, dueAt: at(14, 9) })],
      free: [fb(15, 10, 12)],
      now,
      hourOf,
      dayKeyOf,
    });
    expect(noRoom.unplaceable[0].reason).toBe("no_time_before_due");

    const empty = proposeBlocks({
      tasks: [task({ id: "x", estimatedMinutes: 60 })],
      free: [],
      now,
      hourOf,
      dayKeyOf,
    });
    expect(empty.unplaceable[0].reason).toBe("no_free_time");
  });
});
