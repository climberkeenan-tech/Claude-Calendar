/**
 * Plan / replan smoke (dev tooling — never imported by the app).
 *
 * "Plan my week in under five minutes" is a headline promise, and accept is
 * the write behind it: it creates study blocks in one batch and, on a replan,
 * sweeps aside the stale blocks from the previous plan. Undo has to take all
 * of that back — including what the sweep displaced, which it could not do
 * while the sweep hard-DELETED those rows and the screen still said
 * "Undone — nothing was kept".
 *
 * Neither accept nor undo had ever run.
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

const MARK = "Plan smoke";

// Work the planner has a reason to schedule: real estimates, real deadlines.
await pool.query("delete from events where user_id=$1 and title like $2", [userId, `${MARK}%`]);
await pool.query(
  "delete from events where user_id=$1 and source='ai_suggestion'", [userId],
);
for (const [n, days, mins] of [[1, 3, 120], [2, 5, 90], [3, 6, 60]]) {
  await pool.query(
    `insert into events (id,user_id,title,kind,tz,due_at,estimated_minutes,priority)
     values ($1,$2,$3,'task','America/New_York',$4,$5,'high')`,
    [crypto.randomUUID(), userId, `${MARK} essay ${n}`,
     new Date(Date.now() + days * 86400000), mins],
  );
}

const planBlocks = async () =>
  (
    await pool.query(
      `select id, title, source_id, status, starts_at, ends_at from events
        where user_id=$1 and source='ai_suggestion' order by starts_at`,
      [userId],
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

await page.goto(`${BASE}/plan`, { waitUntil: "networkidle" });
const proposed = await page.locator("main").innerText();
check("the planner proposes blocks for the work", /essay/i.test(proposed),
  proposed.slice(0, 90).replace(/\n/g, " "));

const accept = page.locator("main button").filter({ hasText: /Accept plan/i }).first();
await accept.waitFor({ state: "visible", timeout: 20000 });
await accept.click();
await page.waitForTimeout(4000);

let blocks = await planBlocks();
check("accept creates study blocks", blocks.length > 0, `${blocks.length} block(s)`);
check("each is tagged to a plan batch",
  blocks.every((b) => /^plan:[^:]+:/.test(b.source_id ?? "")), blocks[0]?.source_id);
check("and each block has a real span",
  blocks.every((b) => b.ends_at > b.starts_at));
const batchId = blocks[0]?.source_id?.split(":")[1];

// Reminders should have been materialized for them too.
const jobs = (await pool.query(
  `select count(*)::int n from notification_jobs
    where event_id in (select id from events where user_id=$1 and source='ai_suggestion')`,
  [userId])).rows[0].n;
console.log(`      (${jobs} notification job(s) for the new blocks)`);

// --- undo --------------------------------------------------------------------
const undo = page.locator("main button").filter({ hasText: /^Undo$/ }).first();
const hasUndo = (await undo.count()) > 0;
check("the accepted plan offers Undo", hasUndo);
if (hasUndo) {
  await undo.click();
  await page.waitForTimeout(4000);
}

blocks = await planBlocks();
check("undo removes every block the plan created", blocks.length === 0, `${blocks.length} left`);

const logged = (await pool.query(
  "select type, data from activity_log where user_id=$1 and entity_id=$2 order by created_at",
  [userId, batchId])).rows;
check("both halves are in the activity log",
  logged.some((r) => r.type === "week_planned") && logged.some((r) => r.type === "plan_undone"),
  JSON.stringify(logged.map((r) => r.type)));
check("the plan recorded what it swept, so undo can restore it",
  logged.find((r) => r.type === "week_planned")?.data?.sweptIds !== undefined,
  JSON.stringify(logged.find((r) => r.type === "week_planned")?.data ?? {}));

// --- the sweep, and whether undo really puts it back -------------------------
// A replan sweeps aside stale blocks from an earlier plan. That sweep used to
// HARD DELETE them while the screen offered Undo and then said "nothing was
// kept" — so replanning silently destroyed whatever it displaced. It cancels
// now, and undo restores.
const staleId = crypto.randomUUID();
await pool.query(
  `insert into events (id,user_id,title,kind,tz,starts_at,ends_at,source,source_id,status)
   values ($1,$2,'${MARK} stale block','event','America/New_York',$3,$4,'ai_suggestion','plan:older:x','scheduled')`,
  [staleId, userId,
   new Date(Date.now() - 4 * 3600000), new Date(Date.now() - 3 * 3600000)],
);

// Replan-today only considers work due inside ~2 days, so give it something
// imminent or it has nothing to propose and never reaches the sweep.
await pool.query(
  `insert into events (id,user_id,title,kind,tz,due_at,estimated_minutes,priority)
   values ($1,$2,$3,'task','America/New_York',$4,60,'critical')`,
  [crypto.randomUUID(), userId, `${MARK} due tomorrow`,
   new Date(Date.now() + 26 * 3600000)],
);

await page.goto(`${BASE}/plan?mode=today`, { waitUntil: "networkidle" });
const replanText = await page.locator("main").innerText();
check("replan says it will sweep the stale block", /sweeps 1 stale block/i.test(replanText),
  (replanText.match(/sweeps[^\n]*/) ?? ["not mentioned"])[0]);

const accept2 = page.locator("main button").filter({ hasText: /Accept plan/i }).first();
if (await accept2.count()) {
  await accept2.click();
  await page.waitForTimeout(4000);

  const swept = (await pool.query("select status from events where id=$1", [staleId])).rows[0];
  check("the sweep CANCELS the stale block rather than deleting it",
    swept?.status === "cancelled", swept ? `status=${swept.status}` : "row is gone");

  const undo2 = page.locator("main button").filter({ hasText: /^Undo$/ }).first();
  if (await undo2.count()) {
    await undo2.click();
    await page.waitForTimeout(4000);
    const restored = (await pool.query("select status from events where id=$1", [staleId])).rows[0];
    check("and undo puts it back, so \"nothing was kept\" is true",
      restored?.status === "scheduled", restored ? `status=${restored.status}` : "row is gone");
  } else {
    check("replan offers Undo", false);
  }
} else {
  check("replan offers an Accept button", false, replanText.slice(0, 80).replace(/\n/g, " "));
}

check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await pool.query("delete from events where user_id=$1 and title like $2", [userId, `${MARK}%`]);
await pool.end();
await browser.close();
console.log(`\n${problems.length === 0 ? "Plan flow healthy." : `${problems.length} problem(s):`}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
