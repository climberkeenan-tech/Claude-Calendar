/**
 * Integration-test plumbing: a REAL Postgres, the REAL schema, the REAL query
 * functions.
 *
 * Why this exists: neon-http cannot speak to a local Postgres, so for most of
 * this project's life the ~6,500 lines that touch the database were unreachable
 * by any test — everything green was pure logic, and the queries underneath it
 * were only ever exercised in production. `db.batch`, the kind invariants, the
 * exclusive-end window predicates and the timezone bucketing all live down
 * here, and every one of them has already been the source of a real defect.
 *
 * These tests are SKIPPED, not failed, when no local Postgres is configured, so
 * the unit suite still runs anywhere. Point INTEGRATION_DATABASE_URL (or a
 * loopback DATABASE_URL) at a scratch database to turn them on.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { categories, users, userSettings } from "@/lib/db/schema";

export const TZ = "America/New_York";

/**
 * Wipe every table, asking the database which ones exist rather than keeping a
 * hand-written list — that list is exactly the kind of thing that silently
 * rots the next time a migration adds a table, leaving rows behind to poison
 * the following test. TRUNCATE ... CASCADE makes the order irrelevant.
 */
export async function resetDb(): Promise<void> {
  const rows = await db.execute<{ table_name: string }>(
    sql.raw(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
         and table_name <> '__drizzle_migrations'`,
    ),
  );
  const names = (Array.isArray(rows) ? rows : (rows.rows ?? [])) as {
    table_name: string;
  }[];
  if (names.length === 0) {
    throw new Error(
      "No tables found — apply the migrations to the integration database first.",
    );
  }
  const list = names.map((r) => `"${r.table_name}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE ${list} RESTART IDENTITY CASCADE`));
}

export type Seeded = { userId: string; categoryIds: Record<string, string> };

/** A user with the default categories, which is what sign-in produces. */
export async function seedUser(email = "student@example.com"): Promise<Seeded> {
  const userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email, name: "Test Student" });
  await db.insert(userSettings).values({ userId, defaultReminders: {} });

  const names = ["Classes", "Homework", "Exams", "Personal"];
  const rows = names.map((name, i) => ({
    id: crypto.randomUUID(),
    userId,
    name,
    color: "#D97757",
    isDefault: true,
    position: i,
  }));
  await db.insert(categories).values(rows);

  return {
    userId,
    categoryIds: Object.fromEntries(rows.map((r) => [r.name, r.id])),
  };
}

/** An instant from a profile-timezone wall clock, so fixtures read as dates. */
export function at(dayIso: string, hhmm: string): Date {
  // Same trick the app uses: build the wall clock as fake-UTC, then find the
  // real instant by asking what offset that zone had at roughly that moment.
  const naive = new Date(`${dayIso}T${hhmm}:00Z`);
  const guess = new Date(naive.getTime());
  for (let i = 0; i < 2; i++) {
    const shown = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(guess);
    const g = (t: string) => Number(shown.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
    guess.setTime(guess.getTime() + (naive.getTime() - asUtc));
  }
  return guess;
}
