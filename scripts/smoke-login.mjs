/**
 * Owner sign-in smoke (dev tooling — never imported by the app).
 *
 * Every other script here mints a session cookie directly, which means the
 * login page itself has never actually been used by anything. That is exactly
 * the shape of hole that let quick add ship returning 500 on every save: a
 * server action nothing invokes is a server action nobody has tested.
 *
 * This one types a password into the real form and presses the real button.
 * It also checks the two things that would be quietly catastrophic — a wrong
 * password that lets you in, and a password door that appears on an install
 * that never asked for one.
 */
import { chromium } from "playwright-core";
import pg from "pg";
import { assertLocal, ensureLocalUser } from "./seed-local.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const PASSWORD = process.env.SMOKE_OWNER_PASSWORD;
assertLocal(process.env.DATABASE_URL);

if (!PASSWORD) {
  console.error(
    "SMOKE_OWNER_PASSWORD is not set — set it to the plaintext behind\n" +
      "OWNER_PASSWORD_HASH so this can drive the real form.",
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await ensureLocalUser(pool);
await pool.end();

const problems = [];
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) problems.push(label);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

/** A fresh browser every time: signing in has to work from a cold start, not
 * only for a context that already carries a cookie. */
async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { ctx, page, errors };
}

// ===================== the door is visible and described =====================
// Which doors SHOULD be on the page depends on what's configured, so read the
// config rather than hardcoding it — a first deploy has a password and no
// Google, and asserting Google is always there would fail a healthy install.
const googleConfigured = Boolean(
  process.env.AUTH_GOOGLE_ID?.trim() && process.env.AUTH_GOOGLE_SECRET?.trim(),
);
{
  const { ctx, page } = await fresh();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const text = await page.locator("body").innerText();
  check(
    googleConfigured
      ? "Google is offered, because it's configured"
      : "Google is NOT offered, because it isn't configured",
    /Continue with Google/i.test(text) === googleConfigured,
  );
  check("the password door is offered when one is configured",
    (await page.locator("#owner-password").count()) === 1);
  check("and the page never says there's no way in while a door exists",
    !/No way to sign in/i.test(text));
  await ctx.close();
}

// ============================ a wrong password ===============================
{
  const { ctx, page } = await fresh();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator("#owner-password").fill("definitely-not-the-password");
  await page.locator("button[type=submit]").filter({ hasText: /^Sign in$/ }).click();
  await page.waitForTimeout(3500);

  check("a wrong password does NOT let you in", new URL(page.url()).pathname === "/login",
    page.url());
  const cookies = await ctx.cookies();
  check("and mints no session cookie",
    !cookies.some((c) => c.name.includes("session-token")),
    cookies.map((c) => c.name).join(",") || "none");
  const shown = await page.locator("body").innerText();
  check("and says so instead of failing silently", /didn't match/i.test(shown),
    shown.split("\n").filter(Boolean).slice(-2).join(" | "));
  await ctx.close();
}

// ============================= the real thing ================================
{
  const { ctx, page, errors } = await fresh();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator("#owner-password").fill(PASSWORD);
  await page.locator("button[type=submit]").filter({ hasText: /^Sign in$/ }).click();
  await page.waitForTimeout(4000);

  const path = new URL(page.url()).pathname;
  check("the right password signs you in", path !== "/login", `landed on ${path}`);

  const body = await page.locator("body").innerText();
  check("and you land in the app, not on an error",
    /Dashboard/i.test(body) && !/Application error/i.test(body),
    body.slice(0, 80).replace(/\n/g, " "));

  const cookies = await ctx.cookies();
  const session = cookies.find((c) => c.name.includes("session-token"));
  check("with a real session cookie", Boolean(session));
  check("that is httpOnly, so script can't read it", session?.httpOnly === true);

  // The session has to be worth something: reach a page that requires a real
  // app user id, which only exists if the jwt callback bootstrapped a row.
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  const settings = await page.locator("body").innerText();
  check("the session reaches an authenticated page",
    /Settings/i.test(settings) && !/Sign in/i.test(settings.slice(0, 200)),
    settings.slice(0, 70).replace(/\n/g, " "));
  check("and it resolved to a real account",
    /climberkeenan@gmail\.com|student@example\.com/i.test(settings),
    "the jwt callback has to have minted an app user id");

  check("no uncaught page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ===================== `next` survives the round trip ========================
{
  const { ctx, page } = await fresh();
  await page.goto(`${BASE}/login?next=%2Fanalytics`, { waitUntil: "networkidle" });
  await page.locator("#owner-password").fill(PASSWORD);
  await page.locator("button[type=submit]").filter({ hasText: /^Sign in$/ }).click();
  await page.waitForTimeout(4000);
  check("signing in returns you to where you were headed",
    new URL(page.url()).pathname === "/analytics", page.url());
  await ctx.close();
}

// ================== an unauthenticated visitor is still shut out =============
{
  const { ctx, page } = await fresh();
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  check("a stranger still gets bounced to the login page",
    new URL(page.url()).pathname === "/login", page.url());
  await ctx.close();
}

await browser.close();
console.log(`\n${problems.length === 0 ? "Owner sign-in healthy." : `${problems.length} problem(s):`}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
