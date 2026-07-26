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
import { assertLocal, ensureFixtures, ensureLocalUser, EMAIL as email } from "./seed-local.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SECRET = process.env.AUTH_SECRET;
const DB = process.env.DATABASE_URL;
const OUT = process.env.OUT_DIR ?? "/tmp/phase12";
const COOKIE = "authjs.session-token";

assertLocal(DB);

mkdirSync(OUT, { recursive: true });

// ---- 1-2. a real user row and realistic content --------------------------
const pool = new pg.Pool({ connectionString: DB });
const userId = await ensureLocalUser(pool);
await ensureFixtures(pool, userId);
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
