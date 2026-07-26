/**
 * Remaining server actions smoke (dev tooling — never imported by the app).
 *
 * Quick add shipped returning 500 on every save because nothing had ever
 * called it. That is a property of the ACTION, not of quick add — any action
 * can carry the same bomb and pass every test. The other smokes cover the big
 * flows; this one exists to make sure each remaining write has been executed
 * at least once against a real database.
 *
 * Ordered so each check leaves the app in a state the next one can use.
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
const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
await ctx.addCookies([
  { name: "authjs.session-token", value: session, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
]);
const page = await ctx.newPage();
const pageErrors = [];
const badPosts = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("response", (r) => {
  if (r.request().method() === "POST" && r.status() >= 500) {
    badPosts.push(`${new URL(r.url()).pathname} -> ${r.status()}`);
  }
});

/** Click if it's actually actionable; report rather than hang if it isn't. */
const click = async (locator, wait = 2500) => {
  await locator.waitFor({ state: "visible", timeout: 15000 });
  if (!(await locator.isEnabled())) return false;
  await locator.click({ timeout: 10000 });
  await page.waitForTimeout(wait);
  return true;
};

// Previous runs leave tokens behind, and the generate control caps out — which
// shows up as a disabled button rather than an error.
await pool.query("delete from api_tokens where user_id=$1", [userId]);
await pool.query("delete from events where user_id=$1 and title like 'SMOKE%'", [userId]);
await pool.query("delete from courses where user_id=$1 and name like 'SMOKE%'", [userId]);

// ============================ courses (saveCourse) ===========================
await page.goto(`${BASE}/settings/courses`, { waitUntil: "networkidle" });
await click(page.locator("main button").filter({ hasText: /Add course|New course/i }).first());
await page.locator("[role='dialog'] input").first().fill("SMOKE Chemistry 101");
await click(page.locator("[role='dialog'] button").filter({ hasText: /Save course/i }).first(), 3000);
let course = await one("select id, name from courses where user_id=$1 and name=$2",
  [userId, "SMOKE Chemistry 101"]);
check("saveCourse creates a course", Boolean(course), course?.name);

// ====================== scheduling prefs (saveSchedulingPrefs) ===============
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
const dayStart = page.locator("#pref-day-start, input[type=time]").first();
if (await dayStart.count()) {
  await dayStart.fill("07:30");
  const savePrefs = page.locator("main button").filter({ hasText: /^Save/ }).first();
  if (await savePrefs.count()) await click(savePrefs, 3000);
}
const prefs = await one("select day_start, transition_buffer_minutes from user_settings where user_id=$1", [userId]);
check("saveSchedulingPrefs writes the day window", Boolean(prefs), JSON.stringify(prefs));

// ======================= notification settings + test push ===================
const quiet = await one("select channel_prefs from user_settings where user_id=$1", [userId]);
// The channel preferences are aria-pressed buttons, not switches.
const escToggle = page.locator("main button[aria-pressed]").filter({ hasText: /^Email$/ }).first();
if (await escToggle.count()) {
  await click(escToggle, 800);
  // The panel stages edits and reveals a Save; toggling alone is deliberately
  // not a write, so the test has to commit it the way a person would.
  const saveNotif = page.locator("main button").filter({ hasText: /^Save/ }).last();
  if (await saveNotif.count()) await click(saveNotif, 3000);
  const after = await one("select channel_prefs from user_settings where user_id=$1", [userId]);
  check("updateNotificationSettings persists a channel toggle",
    JSON.stringify(after?.channel_prefs) !== JSON.stringify(quiet?.channel_prefs),
    `${JSON.stringify(quiet?.channel_prefs)} -> ${JSON.stringify(after?.channel_prefs)}`);
  await click(escToggle, 800); // put it back
  const saveBack = page.locator("main button").filter({ hasText: /^Save/ }).last();
  if (await saveBack.count()) await click(saveBack, 2500);
} else {
  check("updateNotificationSettings persists a channel toggle", false, "no toggle found");
}

// ============================ feed token rotation ============================
const beforeToken = (await one("select calendar_feed_token t from user_settings where user_id=$1", [userId]))?.t;
const reset = page.locator("main button").filter({ hasText: /Reset link|Rotate/i }).first();
if (await reset.count()) {
  await click(reset, 1500);
  const confirm = page.locator("main button").filter({ hasText: /Reset|Yes|Confirm/i }).last();
  if (await confirm.count()) await click(confirm, 3000);
  const afterToken = (await one("select calendar_feed_token t from user_settings where user_id=$1", [userId]))?.t;
  check("rotateFeedToken issues a new link", Boolean(afterToken) && afterToken !== beforeToken,
    `${String(beforeToken).slice(0, 12)}… -> ${String(afterToken).slice(0, 12)}…`);
} else {
  check("rotateFeedToken issues a new link", false, "no reset control");
}

// ============================== API token revoke =============================
const genOk = await click(page.locator("main button").filter({ hasText: /Generate token/i }).first(), 3000);
check("createApiToken mints one", genOk, genOk ? "" : "generate control disabled");
const liveBefore = (await one("select count(*)::int n from api_tokens where user_id=$1 and revoked_at is null", [userId])).n;
const revoke = page.locator("main button").filter({ hasText: /^Revoke$/i }).first();
if (await revoke.count()) {
  await click(revoke, 1500);
  const yes = page.locator("main button").filter({ hasText: /Revoke|Yes|Confirm/i }).last();
  if (await yes.count()) await click(yes, 3000);
  const liveAfter = (await one("select count(*)::int n from api_tokens where user_id=$1 and revoked_at is null", [userId])).n;
  check("revokeApiToken retires a token", liveAfter < liveBefore, `${liveBefore} -> ${liveAfter}`);
} else {
  check("revokeApiToken retires a token", false, "no revoke control");
}

// ====================== inbox scheduling (scheduleTask) ======================
const inboxId = crypto.randomUUID();
await pool.query(
  `insert into events (id,user_id,title,kind,tz) values ($1,$2,'SMOKE inbox capture','task','America/New_York')`,
  [inboxId, userId],
);
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
const dateInput = page.locator("main input[type=date]").first();
if (await dateInput.count()) {
  const when = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await dateInput.fill(when);
  await page.waitForTimeout(3000);
  const scheduled = await one("select due_at from events where id=$1", [inboxId]);
  check("scheduleTask gives an Inbox capture a date", Boolean(scheduled?.due_at),
    scheduled?.due_at?.toISOString() ?? "still null");
} else {
  check("scheduleTask gives an Inbox capture a date", false, "no inbox date field");
}

// ===================== overdue triage (triageOverdue) ========================
const overdueId = crypto.randomUUID();
await pool.query(
  `insert into events (id,user_id,title,kind,tz,due_at,estimated_minutes,category_id)
   values ($1,$2,'SMOKE overdue exam','task','America/New_York',$3,null,
           (select id from categories where user_id=$2 and name='Exams'))`,
  [overdueId, userId, new Date(Date.now() - 2 * 86400000)],
);
await page.goto(`${BASE}/assignments`, { waitUntil: "networkidle" });
const shrink = page.locator("main button").filter({ hasText: /Shrink/i }).first();
if (await shrink.count()) {
  await click(shrink, 3000);
  const shrunk = await one("select estimated_minutes from events where id=$1", [overdueId]);
  // Exams default to 120 in effectiveEstimate; the categoryName join is what
  // makes "Shrink it" halve 120 rather than the generic 45.
  check("triageOverdue shrinks using the CATEGORY's estimate",
    shrunk?.estimated_minutes === 60, `${shrunk?.estimated_minutes} min`);
} else {
  check("triageOverdue shrinks using the CATEGORY's estimate", false, "no Shrink control");
}

// ========================= checklist + event details =========================
const evId = crypto.randomUUID();
await pool.query(
  `insert into events (id,user_id,title,kind,tz,starts_at,ends_at)
   values ($1,$2,'SMOKE detail event','event','America/New_York',$3,$4)`,
  [evId, userId, new Date(Date.now() + 2 * 86400000), new Date(Date.now() + 2 * 86400000 + 3600000)],
);
await page.goto(`${BASE}/calendar?view=agenda`, { waitUntil: "networkidle" });
await click(page.getByText("SMOKE detail event").first(), 1500);
const more = page.locator("[role='dialog'] button").filter({ hasText: /More details/i }).first();
if (await more.count()) await click(more, 2000);
const newItem = page.locator("[role='dialog'] input[aria-label='New checklist item']").first();
if (await newItem.count()) {
  await newItem.fill("Bring the goggles");
  await newItem.press("Enter");
  await page.waitForTimeout(2500);
  const items = (await one("select count(*)::int n from checklist_items where event_id=$1", [evId])).n;
  check("addChecklistItem writes the item", items === 1, `${items} item(s)`);
  const box = page.locator("[role='dialog'] button[aria-label*='Toggle']").first();
  if (await box.count()) {
    await click(box, 2500);
    const done = await one("select done from checklist_items where event_id=$1", [evId]);
    check("toggleChecklistItem marks it done", done?.done === true, String(done?.done));
  } else {
    check("toggleChecklistItem marks it done", false, "no toggle");
  }
} else {
  check("addChecklistItem writes the item", false, "no checklist input");
}

// ============================== delete the event =============================
const del = page.locator("[role='dialog'] button").filter({ hasText: /^Delete/i }).first();
if (await del.count()) {
  await click(del, 1200);
  const confirmDel = page.locator("[role='dialog'] button").filter({ hasText: /Delete|Yes|Remove/i }).last();
  if (await confirmDel.count()) await click(confirmDel, 3000);
  const gone = (await one("select count(*)::int n from events where id=$1", [evId])).n;
  check("deleteEvent removes the row", gone === 0, `${gone} left`);
} else {
  check("deleteEvent removes the row", false, "no delete control");
}

// ============================== course deletion ==============================
await page.goto(`${BASE}/settings/courses`, { waitUntil: "networkidle" });
// Scope to THIS course's row. Clicking the first Delete on the page deletes
// whichever course happens to be listed first — which passes when this script
// runs alone and quietly deletes someone else's row when it runs after the
// import smoke.
const courseRow = page.locator("main li").filter({ hasText: "SMOKE Chemistry 101" }).first();
const delCourse = courseRow.locator("button").filter({ hasText: /^Delete$/ }).first();
if (await delCourse.count()) {
  await click(delCourse, 1200);
  // The confirm dialog names the course, so this can be checked rather than
  // assumed.
  const dialogTitle = await page.locator("[role='dialog']").innerText().catch(() => "");
  check("the confirm names the right course", dialogTitle.includes("SMOKE Chemistry 101"),
    dialogTitle.split("\n")[0]);
  const yes = page.locator("[role='dialog'] button").filter({ hasText: /Delete course/i }).last();
  if (await yes.count()) await click(yes, 3000);
  const left = (await one("select count(*)::int n from courses where id=$1", [course.id])).n;
  check("deleteCourse removes it", left === 0, `${left} left`);
} else {
  check("deleteCourse removes it", false, "no delete control");
}

check("no server action returned a 500", badPosts.length === 0, badPosts.slice(0, 3).join(" | "));
check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await pool.query("delete from events where user_id=$1 and title like 'SMOKE%'", [userId]);
await pool.query("delete from courses where user_id=$1 and name like 'SMOKE%'", [userId]);
await pool.end();
await browser.close();
console.log(`\n${problems.length === 0 ? "Remaining actions healthy." : `${problems.length} problem(s):`}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
