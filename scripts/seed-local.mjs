/**
 * Shared local seeding for the dev scripts (never imported by the app).
 *
 * Both scripts need a signed-in-looking user, and `npm run test:integration`
 * TRUNCATEs the same scratch database, so either can find it empty. Each
 * re-seeds rather than depending on the other having run first.
 */

const EMAIL = "climberkeenan@gmail.com";

const CATEGORIES = [
  ["Classes", "#6A9BCC"],
  ["Homework", "#7FA65A"],
  ["Exams", "#D97757"],
  ["Personal", "#9B7EC7"],
];

/** The user row and default categories that signing in would create. */
export async function ensureLocalUser(pool) {
  const found = await pool.query("select id from users where email=$1", [EMAIL]);
  if (found.rows.length > 0) return found.rows[0].id;

  const id = crypto.randomUUID();
  await pool.query("insert into users (id, email, name) values ($1,$2,$3)", [id, EMAIL, "Keenan"]);
  await pool.query(
    "insert into user_settings (user_id, default_reminders) values ($1,$2) on conflict do nothing",
    [id, "{}"],
  );
  for (const [i, [name, color]] of CATEGORIES.entries()) {
    await pool.query(
      `insert into categories (id,user_id,name,color,is_default,position)
       values ($1,$2,$3,$4,true,$5) on conflict do nothing`,
      [crypto.randomUUID(), id, name, color, i],
    );
  }
  return id;
}

/** Enough content that pages render with data rather than empty states. */
export async function ensureFixtures(pool, userId) {
  const { rows } = await pool.query("select count(*)::int n from events where user_id=$1", [userId]);
  if (rows[0].n > 0) return;

  const day = (d) => new Date(`2026-09-${String(d).padStart(2, "0")}T13:00:00Z`);
  const add = (o) =>
    pool.query(
      `insert into events (id,user_id,title,kind,category_id,starts_at,ends_at,due_at,all_day,rrule,tz,status,priority)
       values ($1,$2,$3,$4,(select id from categories where user_id=$2 and name=$5),$6,$7,$8,$9,$10,'America/New_York',$11,$12)`,
      [
        crypto.randomUUID(), userId, o.title, o.kind, o.cat ?? null,
        o.startsAt ?? null, o.endsAt ?? null, o.dueAt ?? null,
        o.allDay ?? false, o.rrule ?? null, o.status ?? "scheduled", o.priority ?? "normal",
      ],
    );

  await add({ title: "BIO 110 Lecture", kind: "event", cat: "Classes", startsAt: day(14), endsAt: new Date(day(14).getTime() + 50 * 60000), rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR" });
  await add({ title: "Problem Set 4", kind: "task", cat: "Homework", dueAt: day(16), priority: "high" });
  await add({ title: "Midterm study", kind: "task", cat: "Exams", dueAt: day(18), priority: "critical" });
  await add({ title: "Gym", kind: "habit", cat: "Personal", startsAt: new Date(day(14).getTime() + 4 * 3600000), endsAt: new Date(day(14).getTime() + 5 * 3600000), rrule: "FREQ=WEEKLY;BYDAY=TU,TH" });
  await add({ title: "Fall Break", kind: "event", cat: "Personal", allDay: true, startsAt: day(21), endsAt: day(26) });
}

/** These scripts WRITE, so they must never see a real database. */
export function assertLocal(url) {
  let host = "";
  try {
    host = new URL(url ?? "").hostname;
  } catch {
    /* leave empty */
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    console.error(
      `Refusing to run: DATABASE_URL must point at a local throwaway database (got ${host || "nothing"}).`,
    );
    process.exit(1);
  }
}

export { EMAIL };
