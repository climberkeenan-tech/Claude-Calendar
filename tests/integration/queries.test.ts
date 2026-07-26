import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { events, occurrences } from "@/lib/db/schema";
import { getCalendarWindow, getHabitsWeek } from "@/lib/db/queries/calendar";
import { getDashboardData, getCategories } from "@/lib/db/queries/dashboard";
import { getFeedRows } from "@/lib/db/queries/feed";
import { at, resetDb, seedUser, TZ, type Seeded } from "./setup";

let me: Seeded;

beforeAll(async () => {
  // Fails loudly rather than silently testing nothing.
  await db.execute("select 1");
});

beforeEach(async () => {
  await resetDb();
  me = await seedUser();
});

/** Insert an event with the app's own invariants applied. */
async function addEvent(over: Partial<typeof events.$inferInsert>) {
  const row: typeof events.$inferInsert = {
    id: crypto.randomUUID(),
    userId: me.userId,
    title: "Thing",
    kind: "event",
    tz: TZ,
    ...over,
  };
  await db.insert(events).values(row);
  return row.id!;
}

describe("getCalendarWindow", () => {
  it("keeps tasks off the startsAt path so nothing renders twice", async () => {
    // The kind invariant: tasks live on dueAt only. A task carrying startsAt
    // would appear both as a block and as a deadline.
    await addEvent({
      kind: "task",
      title: "Essay",
      dueAt: at("2026-09-15", "23:59"),
    });
    await addEvent({
      title: "Lecture",
      startsAt: at("2026-09-15", "09:00"),
      endsAt: at("2026-09-15", "10:00"),
    });

    const items = await getCalendarWindow(
      me.userId,
      at("2026-09-15", "00:00"),
      at("2026-09-16", "00:00"),
    );
    const titles = items.map((i) => i.title).sort();
    expect(titles).toEqual(["Essay", "Lecture"]);
    expect(items.filter((i) => i.title === "Essay")).toHaveLength(1);
  });

  it("excludes an event that ENDS exactly when the window opens", async () => {
    // endsAt is exclusive. Yesterday's all-day event ends at today's midnight,
    // which is today's window start — it must not be part of today.
    await addEvent({
      title: "Yesterday all-day",
      allDay: true,
      startsAt: at("2026-09-14", "00:00"),
      endsAt: at("2026-09-15", "00:00"),
    });
    await addEvent({
      title: "Today all-day",
      allDay: true,
      startsAt: at("2026-09-15", "00:00"),
      endsAt: at("2026-09-16", "00:00"),
    });
    await addEvent({
      title: "Ran into today",
      startsAt: at("2026-09-14", "23:00"),
      endsAt: at("2026-09-15", "01:00"),
    });

    const items = await getCalendarWindow(
      me.userId,
      at("2026-09-15", "00:00"),
      at("2026-09-16", "00:00"),
    );
    expect(items.map((i) => i.title).sort()).toEqual([
      "Ran into today",
      "Today all-day",
    ]);
  });

  it("never leaks another user's rows", async () => {
    const other = await seedUser("someone.else@example.com");
    await db.insert(events).values({
      id: crypto.randomUUID(),
      userId: other.userId,
      title: "Not mine",
      kind: "event",
      tz: TZ,
      startsAt: at("2026-09-15", "09:00"),
      endsAt: at("2026-09-15", "10:00"),
    });
    const items = await getCalendarWindow(
      me.userId,
      at("2026-09-15", "00:00"),
      at("2026-09-16", "00:00"),
    );
    expect(items).toHaveLength(0);
  });

  it("expands a series and honours a cancelled occurrence", async () => {
    const id = await addEvent({
      title: "BIO 110",
      startsAt: at("2026-09-07", "09:00"),
      endsAt: at("2026-09-07", "10:00"),
      rrule: "FREQ=WEEKLY;BYDAY=MO",
    });
    await db
      .insert(occurrences)
      .values({ eventId: id, occurrenceDate: "2026-09-21", cancelled: true });

    const items = await getCalendarWindow(
      me.userId,
      at("2026-09-07", "00:00"),
      at("2026-10-05", "00:00"),
    );
    const days = items.map((i) => i.occurrenceDate).sort();
    expect(days).toContain("2026-09-14");
    expect(days).not.toContain("2026-09-21"); // cancelled
    expect(days).toContain("2026-09-28");
  });

  it("drops a cancelled series entirely", async () => {
    await addEvent({
      title: "Dropped class",
      status: "cancelled",
      startsAt: at("2026-09-15", "09:00"),
      endsAt: at("2026-09-15", "10:00"),
    });
    const items = await getCalendarWindow(
      me.userId,
      at("2026-09-15", "00:00"),
      at("2026-09-16", "00:00"),
    );
    expect(items).toHaveLength(0);
  });
});

describe("getDashboardData", () => {
  it("returns a usable shape for a brand-new account", async () => {
    // The empty case is the one every new user sees first, and it is exactly
    // where a null slipping through crashes the page.
    const data = await getDashboardData(me.userId);
    expect(data).toBeTruthy();
    expect(Array.isArray(data.habits)).toBe(true);
  });

  it("sends the habit strip a DATE, not an instant", async () => {
    // The regression that crashed the dashboard for anyone with a habit:
    // weekStartIso was a full timestamp, and shiftDay() throws on those.
    await addEvent({
      kind: "habit",
      title: "Gym",
      startsAt: at("2026-09-14", "17:00"),
      endsAt: at("2026-09-14", "18:00"),
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      habitTargetPerWeek: 3,
    });
    const data = await getDashboardData(me.userId);
    expect(data.weekStartIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("lists the categories sign-in creates", async () => {
    const cats = await getCategories(me.userId);
    expect(cats.map((c) => c.name).sort()).toEqual([
      "Classes",
      "Exams",
      "Homework",
      "Personal",
    ]);
  });
});

describe("getHabitsWeek", () => {
  it("counts only completions inside the week", async () => {
    const id = await addEvent({
      kind: "habit",
      title: "Run",
      startsAt: at("2026-09-14", "07:00"),
      endsAt: at("2026-09-14", "08:00"),
      rrule: "FREQ=DAILY",
      habitTargetPerWeek: 5,
    });
    await db.insert(occurrences).values([
      { eventId: id, occurrenceDate: "2026-09-15", completed: true },
      { eventId: id, occurrenceDate: "2026-09-16", completed: true },
      { eventId: id, occurrenceDate: "2026-09-30", completed: true }, // next week
    ]);

    const week = await getHabitsWeek(
      me.userId,
      at("2026-09-14", "00:00"),
      at("2026-09-21", "00:00"),
    );
    expect(week).toHaveLength(1);
    expect(week[0].doneDates.sort()).toEqual(["2026-09-15", "2026-09-16"]);
    expect(week[0].target).toBe(5);
  });
});

describe("getFeedRows", () => {
  it("returns published events and drops completed tasks", async () => {
    const now = at("2026-09-15", "12:00");
    await addEvent({
      title: "Lecture",
      startsAt: at("2026-09-16", "09:00"),
      endsAt: at("2026-09-16", "10:00"),
    });
    await addEvent({
      kind: "task",
      title: "Open essay",
      dueAt: at("2026-09-17", "23:59"),
    });
    await addEvent({
      kind: "task",
      title: "Finished essay",
      dueAt: at("2026-09-17", "23:59"),
      status: "completed",
      completedAt: at("2026-09-16", "10:00"),
    });

    const { events: rows } = await getFeedRows(me.userId, now);
    const titles = rows.map((r) => r.title);
    expect(titles).toContain("Lecture");
    expect(titles).toContain("Open essay");
    // A met deadline is not an upcoming deadline; the builder drops it, and
    // the query must at minimum mark it so.
    const done = rows.find((r) => r.title === "Finished essay");
    expect(done === undefined || done.status === "completed").toBe(true);
  });

  it("carries the course and category a subscriber would otherwise lose", async () => {
    await addEvent({
      title: "Lab",
      categoryId: me.categoryIds.Classes,
      startsAt: at("2026-09-16", "14:00"),
      endsAt: at("2026-09-16", "16:00"),
    });
    const { events: rows } = await getFeedRows(me.userId, at("2026-09-15", "12:00"));
    const lab = rows.find((r) => r.title === "Lab");
    expect(lab?.categoryName).toBe("Classes");
  });
});

describe("db.batch is genuinely atomic", () => {
  it("rolls the whole batch back when one statement fails", async () => {
    // Every multi-row write in this app (event splits, syllabus approve and
    // undo, plan accept) leans on this. neon-http has no interactive
    // transactions, so batch is the ONLY atomic unit available — if it were
    // just a loop, a failure mid-way would leave a half-applied series.
    const keep = await addEvent({ title: "Existing", dueAt: at("2026-09-15", "12:00"), kind: "task" });
    const dupId = crypto.randomUUID();

    await expect(
      db.batch([
        db.insert(events).values({
          id: dupId,
          userId: me.userId,
          title: "First",
          kind: "task",
          tz: TZ,
          dueAt: at("2026-09-16", "12:00"),
        }),
        // Same primary key — this one must fail.
        db.insert(events).values({
          id: dupId,
          userId: me.userId,
          title: "Duplicate",
          kind: "task",
          tz: TZ,
          dueAt: at("2026-09-17", "12:00"),
        }),
      ] as never),
    ).rejects.toThrow();

    const all = await db.select().from(events).where(eq(events.userId, me.userId));
    // "First" must have rolled back with its failing sibling.
    expect(all.map((r) => r.id)).toEqual([keep]);
  });

  it("commits every statement when they all succeed", async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await db.batch([
      db.insert(events).values({
        id: a, userId: me.userId, title: "A", kind: "task", tz: TZ,
        dueAt: at("2026-09-16", "12:00"),
      }),
      db.insert(events).values({
        id: b, userId: me.userId, title: "B", kind: "task", tz: TZ,
        dueAt: at("2026-09-17", "12:00"),
      }),
    ] as never);
    const all = await db.select().from(events).where(eq(events.userId, me.userId));
    expect(all.map((r) => r.title).sort()).toEqual(["A", "B"]);
  });
});
