/**
 * Reminder pipeline smoke (dev tooling — never imported by the app).
 *
 * "Never miss an important deadline" is the app's core promise, and none of
 * the machinery behind it had ever run: setting a reminder, materializing the
 * notification jobs, and — the part with real teeth — RE-SYNCING without
 * destroying state that already exists.
 *
 * Delivery itself needs QStash and push credentials, so this asserts on the
 * notification_jobs rows, which is where the scheduling decisions live. A job
 * at the right instant is the thing that can be got wrong silently.
 */
import { chromium } from "playwright-core";
import { encode } from "next-auth/jwt";
import pg from "pg";
import { assertLocal, ensureLocalUser } from "./seed-local.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
assertLocal(process.env.DATABASE_URL);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const userId = await ensureLocalUser(pool);
const session = await encode({
  token: { appUserId: userId, sub: userId },
  secret: process.env.AUTH_SECRET,
  salt: "authjs.session-token",
  maxAge: 3600,
});

const problems = [];
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) problems.push(label);
};

// A lecture far enough out that every offset lands in the future.
const startsAt = new Date(Date.now() + 8 * 24 * 3600 * 1000);
const eventId = crypto.randomUUID();
await pool.query("delete from events where user_id=$1 and title='Reminder pipeline lecture'", [userId]);
await pool.query(
  `insert into events (id,user_id,title,kind,tz,starts_at,ends_at)
   values ($1,$2,'Reminder pipeline lecture','event','America/New_York',$3,$4)`,
  [eventId, userId, startsAt, new Date(startsAt.getTime() + 3600_000)],
);

const jobs = async () =>
  (
    await pool.query(
      `select j.id, j.status, j.send_at, j.channel, r.offset_minutes
         from notification_jobs j left join reminders r on r.id = j.reminder_id
        where j.event_id = $1 order by j.send_at`,
      [eventId],
    )
  ).rows;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.addCookies([
  { name: "authjs.session-token", value: session, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
]);
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

/** Open the event sheet and reveal the details section that holds reminders. */
async function openDetails() {
  await page.goto(`${BASE}/calendar?view=agenda`, { waitUntil: "networkidle" });
  await page.getByText("Reminder pipeline lecture").first().click();
  await page.waitForSelector("[role='dialog']", { timeout: 15000 });
  const more = page.locator("[role='dialog'] button").filter({ hasText: /More details/i }).first();
  if (await more.count()) await more.click();
  await page.waitForTimeout(2000);
}

async function toggle(label) {
  const chip = page.locator("[role='dialog'] button").filter({ hasText: new RegExp(`^${label}$`) }).first();
  await chip.waitFor({ state: "visible", timeout: 15000 });
  await chip.click();
  await page.waitForTimeout(2000);
  return chip;
}

await openDetails();
await toggle("1 day");
await toggle("1 hour");

let rows = await jobs();
// Two channels per reminder by design: the in-app bell entry plus the push.
const channels = [...new Set(rows.map((r) => r.channel))].sort();
check("each reminder fans out to the bell and the push",
  rows.length === 4 && JSON.stringify(channels) === '["in_app","push"]',
  `${rows.length} job(s) across ${JSON.stringify(channels)}`);
const offsets = [...new Set(rows.map((r) => r.offset_minutes))].sort((a, b) => a - b);
check("with the offsets that were chosen", JSON.stringify(offsets) === "[60,1440]", JSON.stringify(offsets));

const dayJob = rows.find((r) => r.offset_minutes === 1440 && r.channel === "push");
const wantedAt = new Date(startsAt.getTime() - 1440 * 60000);
const skewMin = dayJob ? Math.abs(dayJob.send_at - wantedAt) / 60000 : 999;
check("the 1-day job is scheduled a day before the class", skewMin < 1,
  `off by ${skewMin.toFixed(1)} min`);

// --- the part that used to destroy state ------------------------------------
// notification_jobs cascades from reminders, and that table holds the sent
// bell entries and any active snooze. setEventReminders used to delete every
// reminder row and re-insert, so nudging ONE reminder silently rebuilt the
// jobs for ALL of them — losing history and un-snoozing the event. The
// property that proves the fix is IDENTITY: the untouched reminder's job rows
// must be the same rows afterwards, not equivalent ones with new ids.
const before = new Map((await jobs()).map((r) => [r.id, r.offset_minutes]));

await openDetails();
await toggle("30 minutes"); // add a third; the other two must not be rebuilt

rows = await jobs();
check("adding a third reminder gives six jobs", rows.length === 6, `${rows.length} job(s)`);
const survivors = rows.filter((r) => before.has(r.id));
check("the existing reminders' jobs were left ALONE, not rebuilt",
  survivors.length === before.size, `${survivors.length} of ${before.size} kept their ids`);

// And removing one must take only its own.
const thirtyIds = new Set(rows.filter((r) => r.offset_minutes === 30).map((r) => r.id));
await openDetails();
await toggle("30 minutes"); // turn it back off

rows = await jobs();
check("removing a reminder removes only its jobs", rows.length === 4, `${rows.length} job(s)`);
check("and still leaves the original four untouched",
  rows.filter((r) => before.has(r.id)).length === before.size,
  `${rows.filter((r) => before.has(r.id)).length} of ${before.size}`);
check("the removed reminder's jobs are gone",
  rows.every((r) => !thirtyIds.has(r.id)));

// --- deleting the event cleans up -------------------------------------------
await pool.query("delete from events where id=$1", [eventId]);
const leftovers = await jobs();
check("deleting the event cascades its jobs away", leftovers.length === 0, `${leftovers.length} left`);

check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await pool.end();
await browser.close();
console.log(`\n${problems.length === 0 ? "Reminder pipeline healthy." : `${problems.length} problem(s):`}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
