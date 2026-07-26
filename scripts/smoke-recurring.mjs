/**
 * Recurring-series editing smoke (dev tooling — never imported by the app).
 *
 * The three edit scopes are the most intricate writes here: "this one" stores
 * an override, "whole series" rewrites one row, and "this & future" SPLITS the
 * series into two and has to carry everything across. Every one of those has
 * produced a real defect — a bound dropped so 29 meetings became 193, a
 * checklist stranded on the past half, a cleared room that snapped back.
 *
 * Nothing here had ever run.
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

const TITLE = "Recurring smoke seminar";

/** Monday of next week at 09:00 America/New_York, as a real instant. */
function nextMonday9am() {
  const d = new Date();
  d.setUTCHours(13, 0, 0, 0); // 09:00 EDT
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() !== 1);
  return d;
}

async function seedSeries() {
  await pool.query("delete from events where user_id=$1 and title like $2", [userId, `${TITLE}%`]);
  const id = crypto.randomUUID();
  const startsAt = nextMonday9am();
  // Bounded ten weeks out — the bound is the thing a split used to lose.
  const until = new Date(startsAt.getTime() + 70 * 86400000);
  const stamp = (d) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}T090000Z`;
  await pool.query(
    `insert into events (id,user_id,title,kind,tz,location,starts_at,ends_at,rrule)
     values ($1,$2,$3,'event','America/New_York','Congdon 210',$4,$5,$6)`,
    [id, userId, TITLE, startsAt, new Date(startsAt.getTime() + 3600_000),
     `FREQ=WEEKLY;BYDAY=MO;UNTIL=${stamp(until)}`],
  );
  // Things that belong to the SERIES and must cross a split with it.
  await pool.query(
    `insert into checklist_items (id,event_id,text,done,position) values ($1,$2,'Print the reading',false,0)`,
    [crypto.randomUUID(), id],
  );
  await pool.query(
    `insert into attachments (id,event_id,blob_url,filename,mime,size)
     values ($1,$2,'https://example.invalid/lab-manual.pdf','lab-manual.pdf','application/pdf',1024)`,
    [crypto.randomUUID(), id],
  );
  return { id, startsAt };
}

const rowsFor = async () =>
  (
    await pool.query(
      `select id, title, location, rrule, starts_at, status from events
        where user_id=$1 and title like $2 order by starts_at`,
      [userId, `${TITLE}%`],
    )
  ).rows;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
await ctx.addCookies([
  { name: "authjs.session-token", value: session, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
]);
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

/** Open the Nth occurrence of the series from the agenda. */
async function openOccurrence(n = 0) {
  await page.goto(`${BASE}/calendar?view=agenda`, { waitUntil: "networkidle" });
  await page.getByText(TITLE, { exact: false }).nth(n).click();
  await page.waitForSelector("[role='dialog']", { timeout: 15000 });
  await page.waitForTimeout(800);
}

async function pickScope(label) {
  const chip = page.locator("[role='dialog']").getByText(label, { exact: true }).first();
  await chip.click();
  await page.waitForTimeout(400);
}

async function save() {
  await page.locator("[role='dialog'] button").filter({ hasText: /^Save/ }).first().click();
  await page.waitForTimeout(3000);
}

// ============================== whole series =================================
let seeded = await seedSeries();
await openOccurrence(1); // not the first, to prove the anchor isn't moved
await pickScope("Whole series");
await page.locator("[role='dialog'] input").first().fill(`${TITLE} renamed`);
await save();

let rows = await rowsFor();
check("whole-series edit rewrites ONE row", rows.length === 1, `${rows.length} rows`);
check("with the new title", rows[0]?.title === `${TITLE} renamed`, rows[0]?.title);
check("and keeps the series anchored where it was",
  rows[0]?.starts_at?.getTime() === seeded.startsAt.getTime(),
  `${rows[0]?.starts_at?.toISOString()} vs ${seeded.startsAt.toISOString()}`);
check("and keeps its UNTIL bound", (rows[0]?.rrule ?? "").includes("UNTIL="), rows[0]?.rrule);

// ============================== this one only ================================
seeded = await seedSeries();
await openOccurrence(2);
await pickScope("This one");
await page.locator("[role='dialog'] input").first().fill(`${TITLE} one-off`);
// Blank the room for this meeting only — this used to snap back to the series.
const locField = page.locator("#ed-loc");
await locField.fill("");
await save();

rows = await rowsFor();
check("a single-occurrence edit creates no second row", rows.length === 1, `${rows.length} rows`);
const overrides = (await pool.query(
  "select occurrence_date, overrides from occurrences where event_id=$1", [seeded.id])).rows;
check("it stores an override instead", overrides.length === 1, JSON.stringify(overrides[0] ?? {}));
check("the override carries the new title",
  overrides[0]?.overrides?.title === `${TITLE} one-off`, overrides[0]?.overrides?.title);
check("and a CLEARED room stays cleared, not inherited",
  overrides[0]?.overrides?.location === "", JSON.stringify(overrides[0]?.overrides?.location));

// ============================== this & future ================================
seeded = await seedSeries();
const oldId = seeded.id;
await openOccurrence(3); // split at the fourth meeting
await pickScope("This & future");
await page.locator("[role='dialog'] input").first().fill(`${TITLE} moved`);
await save();

rows = await rowsFor();
check("this-and-future splits into two series", rows.length === 2, `${rows.length} rows`);
const oldHalf = rows.find((r) => r.id === oldId);
const newHalf = rows.find((r) => r.id !== oldId);
check("the old half is trimmed with an UNTIL", (oldHalf?.rrule ?? "").includes("UNTIL="), oldHalf?.rrule);
check("the new half KEEPS the original bound",
  (newHalf?.rrule ?? "").includes("UNTIL="),
  `${newHalf?.rrule} — a dropped bound is how 29 meetings became 193`);

const carried = async (table) =>
  (await pool.query(`select count(*)::int n from ${table} where event_id=$1`, [newHalf.id])).rows[0].n;
check("the checklist crossed the split", (await carried("checklist_items")) === 1);
check("the attachment crossed the split", (await carried("attachments")) === 1);
const blobs = (await pool.query(
  "select count(distinct blob_url)::int n, count(*)::int rows from attachments where event_id in ($1,$2)",
  [oldId, newHalf.id])).rows[0];
check("both halves point at the SAME immutable blob",
  blobs.n === 1 && blobs.rows === 2, JSON.stringify(blobs));

check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await pool.query("delete from events where user_id=$1 and title like $2", [userId, `${TITLE}%`]);
await pool.end();
await browser.close();
console.log(`\n${problems.length === 0 ? "Recurring edits healthy." : `${problems.length} problem(s):`}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
