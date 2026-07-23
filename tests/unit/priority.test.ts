import { describe, expect, it } from "vitest";
import { priorityScore, sortByPriority } from "@/lib/analytics/priority";

const now = new Date("2026-09-01T12:00:00Z");
const inHours = (h: number) => new Date(now.getTime() + h * 3600_000);

const base = {
  priority: "normal" as const,
  estimatedMinutes: null,
  categoryName: null,
};

describe("priorityScore", () => {
  it("overdue beats everything else", () => {
    const overdue = priorityScore({ ...base, dueAt: inHours(-2) }, now);
    const critSoon = priorityScore(
      { ...base, priority: "critical", dueAt: inHours(30) },
      now,
    );
    expect(overdue).toBeGreaterThan(critSoon);
  });

  it("deadline pressure dominates equal-priority tasks", () => {
    const today = priorityScore({ ...base, dueAt: inHours(6) }, now);
    const nextWeek = priorityScore({ ...base, dueAt: inHours(6 * 24) }, now);
    expect(today).toBeGreaterThan(nextWeek);
  });

  it("an exam outranks same-day homework", () => {
    const exam = priorityScore(
      { ...base, categoryName: "Exams", dueAt: inHours(20) },
      now,
    );
    const hw = priorityScore(
      { ...base, categoryName: "Homework", dueAt: inHours(20) },
      now,
    );
    expect(exam).toBeGreaterThan(hw);
  });

  it("big estimates pull week-out work earlier", () => {
    const bigPaper = priorityScore(
      { ...base, estimatedMinutes: 240, dueAt: inHours(5 * 24) },
      now,
    );
    const quickie = priorityScore(
      { ...base, estimatedMinutes: 15, dueAt: inHours(5 * 24) },
      now,
    );
    expect(bigPaper).toBeGreaterThan(quickie);
  });

  it("sortByPriority is stable and deadline-tiebroken", () => {
    const tasks = [
      { id: "far", ...base, dueAt: inHours(10 * 24) },
      { id: "near", ...base, dueAt: inHours(3) },
      { id: "undated", ...base, dueAt: null },
    ];
    const sorted = sortByPriority(tasks, now).map((t) => t.id);
    expect(sorted).toEqual(["near", "far", "undated"]);
  });
});
