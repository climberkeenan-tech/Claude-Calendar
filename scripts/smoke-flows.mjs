/**
 * End-to-end smoke flows (dev tooling — never imported by the app).
 *
 * Drives the real UI in a real browser against a real database and then asks
 * the database whether it agrees. Unit and integration tests both pass over a
 * server action that throws at runtime — this is the only thing that catches
 * that, and on its first run it caught exactly that: quick add, the primary
 * way into the app, returning 500 on every save.
 *
 * Signs in the way a Google login does, by minting an Auth.js session token
 * with the app's own AUTH_SECRET. Nothing is stubbed. Refuses to run against
 * anything but a loopback database, because it writes rows.
 */
import { chromium } from "playwright-core";
import { encode } from "next-auth/jwt";
import pg from "pg";
import { assertLocal, ensureFixtures, ensureLocalUser } from "./seed-local.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DB = process.env.DATABASE_URL;
const SECRET = process.env.AUTH_SECRET;
const COOKIE = "authjs.session-token";

assertLocal(DB);

const pool = new pg.Pool({ connectionString: DB });
// Re-seeds if needed: the integration suite truncates this same database, so
// neither script may assume the other ran first.
const userId = await ensureLocalUser(pool);
await ensureFixtures(pool, userId);
const token = await encode({
  token: { appUserId: userId, sub: userId },
  secret: SECRET,
  salt: COOKIE,
  maxAge: 3600,
});

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([
  { name: COOKIE, value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
]);
const page = await ctx.newPage();

const problems = [];
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("response", (r) => {
  if (r.request().method() !== "POST" || r.status() < 400) return;
  const path = new URL(r.url()).pathname;
  // The Claude refinement endpoint answers 503 when ANTHROPIC_API_KEY isn't
  // set, and quick add is designed to fall back to the local parse — that's
  // the degradation working, not a failure. Everything else is real.
  if (path === "/api/quick-add/parse" && r.status() === 503) return;
  problems.push(`POST ${path} -> ${r.status()}`);
});

const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) problems.push(label);
};

/** Type something into quick add and confirm it. */
async function quickAdd(text) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  // The FAB is a client component; wait for hydration rather than racing it.
  const fab = page.locator("button", { hasText: "Quick add" }).first();
  await fab.waitFor({ state: "visible", timeout: 30000 });
  await fab.click();
  await page.waitForSelector("[role='dialog']", { timeout: 15000 });
  await page.waitForTimeout(2500); // the panel is a lazy chunk
  const box = page
    .locator("[role='dialog'] input:not([type=hidden]), [role='dialog'] textarea")
    .first();
  await box.click();
  await box.type(text, { delay: 12 });
  await page.waitForTimeout(1500); // local parse + chips
  const preview = (await page.locator("[role='dialog']").innerText()).replace(/\n+/g, " | ");
  await page.locator("[role='dialog'] button").filter({ hasText: "Add" }).last().click();
  await page.waitForTimeout(2500);
  const stillOpen = (await page.locator("[role='dialog']").count()) > 0;
  return { preview, stillOpen };
}

const rowFor = async (like) =>
  (
    await pool.query(
      "select title, kind, starts_at, due_at, status, completed_at from events where user_id=$1 and title ilike $2",
      [userId, like],
    )
  ).rows[0];

// --- an EVENT ---------------------------------------------------------------
const ev = await quickAdd("Study for BIO midterm Friday at 3pm");
check("quick add closes on save", !ev.stillOpen, ev.stillOpen ? ev.preview.slice(0, 120) : "");
const evRow = await rowFor("%BIO midterm%");
check("event reached the database", Boolean(evRow), JSON.stringify(evRow));
check("title has no leftover date words", evRow?.title === "Study for BIO midterm", evRow?.title);
check("stored as an event on startsAt", evRow?.kind === "event" && !!evRow?.starts_at);
check(
  "3pm local, not 3pm UTC",
  evRow?.starts_at?.toISOString() === "2026-07-31T19:00:00.000Z",
  evRow?.starts_at?.toISOString(),
);

await page.goto(`${BASE}/calendar?view=agenda`, { waitUntil: "networkidle" });
check("agenda shows it", (await page.locator("main").innerText()).includes("BIO midterm"));

// --- a TASK -----------------------------------------------------------------
await quickAdd("Chem lab writeup due Thursday");
const taskRow = await rowFor("%Chem lab%");
check("task reached the database", Boolean(taskRow), JSON.stringify(taskRow));
check("title has no leftover 'due'", taskRow?.title === "Chem lab writeup", taskRow?.title);
check("stored as a task on dueAt", taskRow?.kind === "task" && !!taskRow?.due_at);
check(
  "a named day means the END of that day",
  taskRow?.due_at?.toISOString() === "2026-07-31T03:59:00.000Z", // 23:59 EDT Thu
  taskRow?.due_at?.toISOString(),
);

await page.goto(`${BASE}/assignments`, { waitUntil: "networkidle" });
check("assignments shows it", (await page.locator("main").innerText()).includes("Chem lab"));

// Target THIS task's button, not the first one on the board — the fixtures
// put other assignments above it, and completing one of those would have
// looked like a pass while proving nothing.
const complete = page.locator('main button[aria-label*="Chem lab writeup"]').first();
if (await complete.count()) {
  await complete.click();
  await page.waitForTimeout(2500);
  const done = await rowFor("%Chem lab%");
  check("completing it writes through", done?.status === "completed" && !!done?.completed_at,
    `status=${done?.status}`);
} else {
  check("completing it writes through", false, "no complete control found");
}

check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await pool.end();
await browser.close();

console.log(`\n${problems.length === 0 ? "All flows passed." : `${problems.length} problem(s):`}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
