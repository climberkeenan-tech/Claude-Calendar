import { describe, expect, it } from "vitest";
import {
  boundRrule,
  draftToApproveItem,
  minutesBetween,
  toReviewDraft,
  untilForDate,
} from "@/lib/import/map";
import type { SyllabusItem } from "@/lib/import/schema";

const base: SyllabusItem = {
  kind: "assignment",
  title: "Problem Set 3",
  date: "2026-10-14",
  endDate: null,
  startTime: null,
  endTime: null,
  rrule: null,
  notes: null,
  confidence: 0.95,
  sourceExcerpt: "PS3 due Oct 14",
};
const noTerm = { termEnd: null };

describe("toReviewDraft", () => {
  it("assignments become tasks due end-of-day", () => {
    const d = toReviewDraft(base, 0, noTerm);
    expect(d.kind).toBe("task");
    expect(d.categoryName).toBe("Homework");
    expect(d.accepted).toBe(true);
    const item = draftToApproveItem(d)!;
    expect(item.dueLocal).toBe("2026-10-14T23:59");
    expect(item.startLocal).toBeNull();
  });

  it("a timed exam becomes an event with real duration", () => {
    const d = toReviewDraft(
      {
        ...base,
        kind: "exam",
        title: "Midterm",
        startTime: "09:00",
        endTime: "10:40",
      },
      1,
      noTerm,
    );
    expect(d.kind).toBe("event");
    expect(d.categoryName).toBe("Exams");
    expect(d.durationMinutes).toBe(100);
    const item = draftToApproveItem(d)!;
    expect(item.startLocal).toBe("2026-10-14T09:00");
    expect(item.allDay).toBe(false);
  });

  it("an exam with no end time falls back to a 120-minute block", () => {
    const d = toReviewDraft(
      { ...base, kind: "exam", startTime: "14:00" },
      2,
      noTerm,
    );
    expect(d.durationMinutes).toBe(120);
  });

  it("untimed non-holiday items become all-day events", () => {
    const d = toReviewDraft({ ...base, kind: "other" }, 3, noTerm);
    expect(d.allDay).toBe(true);
    const item = draftToApproveItem(d)!;
    expect(item.startLocal).toBe("2026-10-14T00:00");
    expect(item.allDay).toBe(true);
    expect(item.durationMinutes).toBeNull();
  });

  it("holidays are all-day even when the syllabus lists a time", () => {
    const d = toReviewDraft(
      { ...base, kind: "holiday", startTime: "08:00" },
      4,
      noTerm,
    );
    expect(d.allDay).toBe(true);
  });

  it("dateless items start unchecked — no Inbox spam from imports", () => {
    const d = toReviewDraft({ ...base, date: null }, 5, noTerm);
    expect(d.accepted).toBe(false);
    expect(draftToApproveItem(d)).toBeNull();
  });

  it("recurring class series keep the rrule, bounded at term end", () => {
    const d = toReviewDraft(
      {
        ...base,
        kind: "class_session",
        title: "BIO 1500",
        date: "2026-08-24",
        startTime: "10:00",
        endTime: "10:50",
        rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      },
      6,
      { termEnd: "2026-12-04" },
    );
    expect(d.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261204T235959Z");
    expect(d.durationMinutes).toBe(50);
    expect(d.categoryName).toBe("Classes");
  });

  it("tasks never carry an rrule (tasks live on dueAt only)", () => {
    const d = toReviewDraft(
      { ...base, rrule: "FREQ=WEEKLY;BYDAY=FR" },
      7,
      noTerm,
    );
    expect(d.rrule).toBeNull();
    expect(draftToApproveItem(d)!.rrule).toBeNull();
  });

  it("item endDate outranks term end when bounding the series", () => {
    const d = toReviewDraft(
      {
        ...base,
        kind: "lab",
        date: "2026-08-25",
        endDate: "2026-11-17",
        startTime: "13:00",
        rrule: "FREQ=WEEKLY;BYDAY=TU",
      },
      8,
      { termEnd: "2026-12-04" },
    );
    expect(d.rrule).toContain("UNTIL=20261117T235959Z");
    expect(d.durationMinutes).toBe(110); // lab default
  });
});

describe("rrule bounding helpers", () => {
  it("leaves already-bounded rules untouched", () => {
    expect(boundRrule("FREQ=WEEKLY;UNTIL=20261201T000000Z", "2026-12-25")).toBe(
      "FREQ=WEEKLY;UNTIL=20261201T000000Z",
    );
    expect(boundRrule("FREQ=WEEKLY;COUNT=10", "2026-12-25")).toBe(
      "FREQ=WEEKLY;COUNT=10",
    );
  });
  it("passes through when no end date is known", () => {
    expect(boundRrule("FREQ=WEEKLY;BYDAY=MO", null)).toBe("FREQ=WEEKLY;BYDAY=MO");
  });
  it("formats UNTIL in floating end-of-day encoding", () => {
    expect(untilForDate("2026-12-04")).toBe("20261204T235959Z");
  });
});

describe("minutesBetween", () => {
  it("computes forward spans and rejects inverted ones", () => {
    expect(minutesBetween("09:00", "10:40")).toBe(100);
    expect(minutesBetween("23:00", "01:00")).toBeNull();
    expect(minutesBetween("10:00", "10:00")).toBeNull();
  });
});
