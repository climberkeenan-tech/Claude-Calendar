/**
 * UI verification sweep (dev tooling — never imported by the app).
 *
 * Signs in the way a real Google login does: it mints an Auth.js session token
 * with the app's own AUTH_SECRET and hands it over as a cookie. Nothing in the
 * app is bypassed or stubbed — the allowlist, the JWT callbacks and the layout
 * redirect are all exactly as they ship. Then it walks every route, in light
 * and dark, on desktop and phone, runs axe over each one, and reports.
 */
import { chromium } from "playwright-core";
import { encode } from "next-auth/jwt";
import { readFileSync, mkdirSync } from "node:fs";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SECRET = process.env.AUTH_SECRET;
const DB = process.env.DATABASE_URL;
const OUT = process.env.OUT_DIR ?? "/tmp/phase12";
const COOKIE = "authjs.session-token";

/**
 * This script SEEDS ROWS and mints a session, so it must never be pointed at a
 * real database. A loopback host is the same signal src/lib/db/client.ts uses
 * to choose the local driver, and a Neon URL can never satisfy it.
 */
const host = (() => {
  try {
    return new URL(DB ?? "").hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
  console.error(
    `Refusing to run: DATABASE_URL must point at a local throwaway database (got ${host || "nothing"}).`,
  );
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

// ---- 1. a real user row, created the way sign-in creates one ---------------
const pool = new pg.Pool({ connectionString: DB });
const email = "climberkeenan@gmail.com";
let { rows } = await pool.query("select id from users where email=$1", [email]);
if (rows.length === 0) {
  const id = crypto.randomUUID();
  await pool.query("insert into users (id, email, name) values ($1,$2,$3)", [
    id,
    email,
    "Keenan",
  ]);
  await pool.query(
    "insert into user_settings (user_id, default_reminders) values ($1,$2) on conflict do nothing",
    [id, "{}"],
  );
  const cats = [
    ["Classes", "#6A9BCC"],
    ["Homework", "#7FA65A"],
    ["Exams", "#D97757"],
    ["Personal", "#9B7EC7"],
  ];
  for (const [i, [name, color]] of cats.entries()) {
    await pool.query(
      "insert into categories (id,user_id,name,color,is_default,position) values ($1,$2,$3,$4,true,$5) on conflict do nothing",
      [crypto.randomUUID(), id, name, color, i],
    );
  }
  rows = [{ id }];
}
const userId = rows[0].id;

// ---- 2. realistic content, so pages are exercised with data, not empties ---
const has = await pool.query("select count(*)::int n from events where user_id=$1", [userId]);
if (has.rows[0].n === 0) {
  const day = (d) => new Date(`2026-09-${String(d).padStart(2, "0")}T13:00:00Z`);
  const ev = async (o) => {
    await pool.query(
      `insert into events (id,user_id,title,kind,category_id,starts_at,ends_at,due_at,all_day,rrule,tz,status,priority)
       values ($1,$2,$3,$4,(select id from categories where user_id=$2 and name=$5),$6,$7,$8,$9,$10,'America/New_York',$11,$12)`,
      [
        crypto.randomUUID(), userId, o.title, o.kind, o.cat ?? null,
        o.startsAt ?? null, o.endsAt ?? null, o.dueAt ?? null,
        o.allDay ?? false, o.rrule ?? null, o.status ?? "scheduled",
        o.priority ?? "normal",
      ],
    );
  };
  await ev({ title: "BIO 110 Lecture", kind: "event", cat: "Classes", startsAt: day(14), endsAt: new Date(day(14).getTime() + 50 * 60000), rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR" });
  await ev({ title: "Problem Set 4", kind: "task", cat: "Homework", dueAt: day(16), priority: "high" });
  await ev({ title: "Midterm study", kind: "task", cat: "Exams", dueAt: day(18), priority: "critical" });
  await ev({ title: "Gym", kind: "habit", cat: "Personal", startsAt: new Date(day(14).getTime() + 4 * 3600000), endsAt: new Date(day(14).getTime() + 5 * 3600000), rrule: "FREQ=WEEKLY;BYDAY=TU,TH" });
  await ev({ title: "Fall Break", kind: "event", cat: "Personal", allDay: true, startsAt: day(21), endsAt: day(26) });
}
await pool.end();

// ---- 3. the session cookie a successful Google sign-in would set -----------
const token = await encode({
  token: { appUserId: userId, email, name: "Keenan", sub: userId },
  secret: SECRET,
  salt: COOKIE,
  maxAge: 60 * 60,
});

// ---- 4. walk every route -------------------------------------------------
const ROUTES = ["/", "/calendar", "/assignments", "/plan", "/import", "/analytics", "/settings", "/settings/courses"];
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 },
];
const axeSrc = readFileSync("node_modules/axe-core/axe.min.js", "utf8");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const report = [];

for (const vp of VIEWPORTS) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: theme,
    });
    await ctx.addCookies([
      { name: COOKIE, value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
      { name: "theme", value: theme, domain: "127.0.0.1", path: "/", sameSite: "Lax" },
    ]);
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

    for (const route of ROUTES) {
      const entry = { route, viewport: vp.name, theme };
      try {
        consoleErrors.length = 0;
        const res = await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 30000 });
        entry.status = res?.status();
        entry.url = new URL(page.url()).pathname;
        entry.redirected = entry.url !== route;
        // Did it actually render, or is it a crash page?
        entry.crashed = await page.locator("text=/Application error|Unhandled Runtime Error/i").count() > 0;
        entry.h1 = (await page.locator("h1, h2").first().textContent().catch(() => ""))?.trim().slice(0, 40) ?? "";
        // Horizontal overflow is the classic phone bug.
        entry.overflowX = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        );
        await page.addScriptTag({ content: axeSrc });
        const axe = await page.evaluate(async () =>
          await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] }),
        );
        entry.violations = axe.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length }));
        entry.consoleErrors = [...consoleErrors];
        const file = `${OUT}/${vp.name}-${theme}-${route.replace(/\//g, "_") || "_root"}.png`;
        await page.screenshot({ path: file, fullPage: true });
        entry.shot = file;
      } catch (err) {
        entry.error = String(err).slice(0, 200);
      }
      report.push(entry);
    }
    await ctx.close();
  }
}
await browser.close();

// ---- 5. report -----------------------------------------------------------
const bad = report.filter(
  (r) => r.error || r.crashed || r.redirected || (r.status && r.status >= 400),
);
const a11y = report.flatMap((r) => (r.violations ?? []).map((v) => ({ ...v, route: r.route, theme: r.theme, viewport: r.viewport })));
const overflow = report.filter((r) => r.overflowX);
const errs = report.filter((r) => (r.consoleErrors ?? []).length > 0);

console.log(`\n=== ${report.length} page loads (${ROUTES.length} routes x 2 viewports x 2 themes) ===`);
console.log(`broken:            ${bad.length}`);
console.log(`a11y violations:   ${a11y.length}`);
console.log(`horizontal scroll: ${overflow.length}`);
console.log(`console errors:    ${errs.length}`);

if (bad.length) {
  console.log("\n--- BROKEN ---");
  for (const b of bad) console.log(JSON.stringify(b));
}
if (a11y.length) {
  console.log("\n--- A11Y ---");
  const byId = {};
  for (const v of a11y) (byId[v.id] ??= []).push(`${v.viewport}/${v.theme}${v.route}`);
  for (const [id, where] of Object.entries(byId)) console.log(`${id} (${where.length}): ${where.slice(0, 4).join(", ")}`);
}
if (overflow.length) {
  console.log("\n--- OVERFLOW ---");
  for (const o of overflow) console.log(`${o.viewport}/${o.theme}${o.route}`);
}
if (errs.length) {
  console.log("\n--- CONSOLE ---");
  for (const e of errs) console.log(`${e.viewport}/${e.theme}${e.route}: ${e.consoleErrors.slice(0, 2).join(" | ")}`);
}
console.log("\n--- rendered ---");
for (const r of report.filter((x) => x.viewport === "desktop" && x.theme === "light")) {
  console.log(`${r.route.padEnd(20)} status=${r.status} h=${JSON.stringify(r.h1)}`);
}
