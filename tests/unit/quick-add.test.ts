import { describe, expect, it } from "vitest";
import { parseLocal } from "@/lib/ai/quick-add";

// A fixed "now": Monday 2026-09-14 10:00 (process-local time)
const NOW = new Date(2026, 8, 14, 10, 0, 0);

describe("parseLocal — the brief's acceptance phrasings", () => {
  it("Study Biology tomorrow at 7 PM", () => {
    const d = parseLocal("Study Biology tomorrow at 7 PM", NOW);
    expect(d.startIso).not.toBeNull();
    const start = new Date(d.startIso!);
    expect(start.getDate()).toBe(15);
    expect(start.getHours()).toBe(19);
    expect(d.allDay).toBe(false);
    expect(d.title.toLowerCase()).toContain("biology");
    expect(d.categoryName).toBe("Classes"); // "study" hint
  });

  it("Gym every Monday at 5 → recurring habit", () => {
    const d = parseLocal("Gym every Monday at 5", NOW);
    expect(d.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(d.rruleLabel).toBe("every Monday");
    expect(d.kind).toBe("habit");
    expect(d.habitTargetPerWeek).toBe(1);
    expect(d.title.toLowerCase()).toContain("gym");
  });

  it("Exam next Friday → all-day with Exams category", () => {
    const d = parseLocal("Exam next Friday", NOW);
    expect(d.startIso).not.toBeNull();
    expect(d.categoryName).toBe("Exams");
    const start = new Date(d.startIso!);
    expect(start.getDay()).toBe(5); // a Friday
    expect(start.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("Essay due Friday → task with deadline", () => {
    const d = parseLocal("Essay due Friday", NOW);
    expect(d.kind).toBe("task");
    expect(d.dueIso).not.toBeNull();
    expect(d.startIso).toBeNull();
    expect(d.categoryName).toBe("Homework"); // "essay" hint
  });

  it("Bio homework due tomorrow at noon", () => {
    const d = parseLocal("Bio homework due tomorrow at noon", NOW);
    expect(d.kind).toBe("task");
    const due = new Date(d.dueIso!);
    expect(due.getDate()).toBe(15);
    expect(due.getHours()).toBe(12);
  });

  it("Practice every Tuesday and Thursday at 4pm", () => {
    const d = parseLocal("Practice every Tuesday and Thursday at 4pm", NOW);
    expect(d.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
    expect(d.habitTargetPerWeek).toBe(2);
  });

  it("Meditate every day", () => {
    const d = parseLocal("Meditate every day", NOW);
    expect(d.rrule).toBe("FREQ=DAILY");
    expect(d.kind).toBe("habit");
  });

  it("Dinner with Sam Thursday 6:30-8pm keeps the range", () => {
    const d = parseLocal("Dinner with Sam Thursday 6:30-8pm", NOW);
    const start = new Date(d.startIso!);
    const end = new Date(d.endIso!);
    expect(start.getHours()).toBe(18);
    expect(end.getHours()).toBe(20);
  });

  it("Call mom (no date) → Inbox-bound with no anchor", () => {
    const d = parseLocal("Call mom", NOW);
    expect(d.startIso).toBeNull();
    expect(d.dueIso).toBeNull();
    expect(d.title).toBe("Call mom");
  });

  it("Work shift Saturday 9am → Work category", () => {
    const d = parseLocal("Work shift Saturday 9am", NOW);
    expect(d.categoryName).toBe("Work");
    const start = new Date(d.startIso!);
    expect(start.getDay()).toBe(6);
    expect(start.getHours()).toBe(9);
  });

  it("strips filler and keeps a clean title", () => {
    const d = parseLocal("Study chemistry on Wednesday at 3pm", NOW);
    expect(d.title.toLowerCase()).toMatch(/^study chemistry/);
    expect(d.title.toLowerCase()).not.toContain("wednesday");
  });

  it("parseLocal is fast enough for per-keystroke use", () => {
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      parseLocal("Study Biology tomorrow at 7 PM and gym every Monday", NOW);
    }
    const perCall = (performance.now() - t0) / 200;
    expect(perCall).toBeLessThan(15); // ms — far under the 1.5 s p95 gate
  });
});
