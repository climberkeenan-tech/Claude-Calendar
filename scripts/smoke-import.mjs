/**
 * Syllabus import smoke (dev tooling — never imported by the app).
 *
 * Approve and undo are the heaviest writes in the app: approve creates a whole
 * semester in one batch, undo removes it and decides whether the course it
 * created goes too. Neither had ever run. Extraction itself needs an API key,
 * so this seeds the PROPOSAL the extractor would have stored and drives
 * everything downstream of the review gate, which is where all the logic is.
 *
 * The proposal deliberately includes the shapes that used to break things: an
 * RRULE: -prefixed rule, a multi-day break, and a sub-five-minute quiz.
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

const item = (o) => ({
  kind: "other", title: "Item", date: null, endDate: null,
  startTime: null, endTime: null, rrule: null, notes: null,
  confidence: 0.95, sourceExcerpt: "seeded", ...o,
});

const extraction = {
  course: {
    name: "BIO 110 General Biology", code: "BIO 110", professor: "Dr. Reyes",
    location: "Congdon 210", meetingTimes: "MWF 10:00-10:50", officeHours: null,
    term: "Fall 2026", termStart: "2026-08-24", termEnd: "2026-12-04",
  },
  items: [
    // A model that emits the full property line, which used to be dropped.
    item({ kind: "class_session", title: "BIO 110 Lecture", date: "2026-08-24",
           endDate: "2026-12-04", startTime: "10:00", endTime: "10:50",
           rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR" }),
    // A break that runs five days, which used to collapse to one.
    item({ kind: "holiday", title: "Fall Break", date: "2026-10-12", endDate: "2026-10-16" }),
    // Three minutes, which used to fail the WHOLE import on a schema bound.
    item({ kind: "exam", title: "Pop quiz", date: "2026-09-15",
           startTime: "10:00", endTime: "10:03" }),
    item({ kind: "assignment", title: "Problem Set 1", date: "2026-09-04" }),
  ],
  warnings: [],
};

// The stored column wraps the model's output — see StoredExtraction.
const stored = {
  result: extraction,
  model: "seeded-by-smoke-script",
  extractedAt: new Date("2026-07-26T00:00:00Z").toISOString(),
};

// Clean up anything a previous run left behind. A leftover course makes the
// review screen default to "Link existing" instead of creating one, which
// silently changes what this script is testing.
await pool.query("delete from events where user_id=$1 and (source='syllabus' or title='My own study block')", [userId]);
await pool.query("delete from courses where user_id=$1", [userId]);
await pool.query("delete from syllabus_imports where user_id=$1", [userId]);

const importId = crypto.randomUUID();
await pool.query(
  `insert into syllabus_imports (id,user_id,blob_url,filename,mime,status,extraction)
   values ($1,$2,$3,$4,$5,'review',$6)`,
  [importId, userId, "https://example.invalid/seeded.pdf", "BIO110.pdf",
   "application/pdf", JSON.stringify(stored)],
);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
await ctx.addCookies([
  { name: "authjs.session-token", value: session, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
]);
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.goto(`${BASE}/import/${importId}`, { waitUntil: "networkidle" });
const review = await page.locator("main").innerText();
// Each row's title is an editable <input>, so read values, not text.
const titles = await page.locator("main input[type=text], main input:not([type])").evaluateAll(
  (els) => els.map((e) => e.value).filter(Boolean),
);
check("review screen renders every proposed item",
  ["BIO 110 Lecture", "Fall Break", "Pop quiz", "Problem Set 1"].every((t) => titles.includes(t)),
  JSON.stringify(titles.slice(0, 6)));
check("the recurring class shows a repeats chip", /repeats/i.test(review));

const approve = page.locator("main button").filter({ hasText: /^(Approve|Add|Import)/i }).last();
await approve.waitFor({ state: "visible", timeout: 20000 });
await approve.click();
await page.waitForTimeout(4000);

const rows = (await pool.query(
  `select title, kind, all_day, rrule, starts_at, ends_at, due_at, source, source_id
     from events where user_id=$1 and source_id=$2 order by title`, [userId, importId])).rows;
check("approve created the semester", rows.length === 4, `${rows.length} rows`);

const lecture = rows.find((r) => r.title === "BIO 110 Lecture");
check("the RRULE: prefix was accepted, not dropped",
  Boolean(lecture?.rrule) && lecture.rrule.startsWith("FREQ=WEEKLY"), lecture?.rrule ?? "null");
check("and it kept its term bound", (lecture?.rrule ?? "").includes("UNTIL=20261204"), lecture?.rrule ?? "");

const brk = rows.find((r) => r.title === "Fall Break");
const days = brk ? Math.round((brk.ends_at - brk.starts_at) / 86400000) : 0;
check("the break spans five days, not one", days === 5, `${days} day(s)`);
check("and it is all-day", brk?.all_day === true);

const quiz = rows.find((r) => r.title === "Pop quiz");
const mins = quiz ? Math.round((quiz.ends_at - quiz.starts_at) / 60000) : 0;
check("the sub-5-minute quiz imported, clamped", mins === 5, `${mins} min`);

const ps = rows.find((r) => r.title === "Problem Set 1");
check("the assignment is a task on dueAt", ps?.kind === "task" && !!ps?.due_at);

const course = (await pool.query(
  "select id, name from courses where user_id=$1 and source_import_id=$2", [userId, importId])).rows[0];
check("a course was created and tagged to the import", Boolean(course), course?.name);

// --- the user hangs their OWN event on that course, then undoes the import ---
await pool.query(
  `insert into events (id,user_id,title,kind,course_id,tz,starts_at,ends_at)
   values ($1,$2,'My own study block','event',$3,'America/New_York',$4,$5)`,
  [crypto.randomUUID(), userId, course.id,
   new Date("2026-09-10T18:00:00Z"), new Date("2026-09-10T19:00:00Z")],
);

await page.goto(`${BASE}/import/${importId}`, { waitUntil: "networkidle" });
const undo = page.locator("main button").filter({ hasText: /Undo/i }).first();
const hasUndo = (await undo.count()) > 0;
check("the approved screen offers Undo", hasUndo,
  hasUndo ? "" : (await page.locator("main").innerText()).slice(0, 90).replace(/\n/g, " "));
if (hasUndo) {
  await undo.click();
  await page.waitForTimeout(1500);
  const confirm = page
    .locator("main button, [role='dialog'] button")
    .filter({ hasText: /Undo|Remove|Yes|Confirm/i })
    .last();
  if (await confirm.count()) await confirm.click();
  await page.waitForTimeout(4000);
}

const left = (await pool.query(
  "select count(*)::int n from events where user_id=$1 and source_id=$2", [userId, importId])).rows[0].n;
check("undo removed the imported rows", left === 0, `${left} left`);

const mine = (await pool.query(
  "select course_id from events where user_id=$1 and title='My own study block'", [userId])).rows[0];
check("the user's own event survived", Boolean(mine));
const stillThere = (await pool.query(
  "select count(*)::int n from courses where id=$1", [course.id])).rows[0].n;
// This is the NULL-semantics fix: the user's own event has source_id NULL, and
// `NULL <> importId` is NULL, so a bare ne() counted zero and dropped the course.
check("the course was KEPT because the user's event still uses it", stillThere === 1,
  `${stillThere} course row(s)`);

check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await pool.end();
await browser.close();
console.log(`\n${problems.length === 0 ? "Import flow healthy." : `${problems.length} problem(s):`}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
