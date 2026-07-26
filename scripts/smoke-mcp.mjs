/**
 * MCP surface smoke (dev tooling — never imported by the app).
 *
 * The MCP tools and the UI deliberately share their cores, so a break here is
 * a break in "asking Claude" while the app itself still looks fine. Nothing
 * had ever called this transport. Mints a token through the real settings UI,
 * then drives the tools over the real protocol.
 */
import { chromium } from "playwright-core";
import { encode } from "next-auth/jwt";
import pg from "pg";
import { assertLocal, ensureFixtures, ensureLocalUser } from "./seed-local.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
assertLocal(process.env.DATABASE_URL);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const userId = await ensureLocalUser(pool);
await ensureFixtures(pool, userId);
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

// --- mint a token the way a person would ------------------------------------
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([
  { name: "authjs.session-token", value: session, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
]);
const page = await ctx.newPage();
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
const gen = page.locator("button", { hasText: "Generate token" }).first();
await gen.waitFor({ state: "visible", timeout: 20000 });
await gen.click();
await page.waitForTimeout(3000);
const token = (await page.locator("code").allTextContents())
  .map((t) => t.trim())
  .find((t) => t.startsWith("hpos_"));
check("settings mints a token", Boolean(token), token ? `${token.slice(0, 10)}…` : "none shown");
await browser.close();
if (!token) {
  await pool.end();
  process.exit(1);
}

// --- drive the protocol -----------------------------------------------------
let id = 0;
async function rpc(method, params) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const text = await res.text();
  // The transport may answer as SSE; take the last data: line either way.
  const line = text.includes("data:")
    ? text.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5)
    : text;
  let body = null;
  try {
    body = JSON.parse(line);
  } catch {
    /* leave null */
  }
  return { status: res.status, body, raw: text.slice(0, 200) };
}

const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
check("initialize handshakes", init.status === 200 && !init.body?.error, `${init.status} ${init.raw.slice(0, 80)}`);

const list = await rpc("tools/list", {});
const tools = list.body?.result?.tools ?? [];
check("tools/list returns the toolset", tools.length > 0, `${tools.length} tools`);
if (tools.length) console.log(`      ${tools.map((t) => t.name).join(", ")}`);

const callable = [
  ["get_agenda", {}],
  ["get_upcoming_deadlines", {}],
  ["get_free_time", {}],
  ["get_productivity_summary", {}],
];
for (const [name, args] of callable) {
  if (!tools.some((t) => t.name === name)) {
    console.log(`SKIP  ${name} — not in the toolset`);
    continue;
  }
  const r = await rpc("tools/call", { name, arguments: args });
  const errored = r.status !== 200 || Boolean(r.body?.error) || r.body?.result?.isError;
  check(`${name} answers`, !errored, errored ? JSON.stringify(r.body ?? r.raw).slice(0, 160) : "");
}

// A write, then confirm it in the database.
if (tools.some((t) => t.name === "add_item")) {
  const r = await rpc("tools/call", {
    name: "add_item",
    arguments: { title: "MCP smoke task", kind: "task", dueLocal: "2026-08-05T23:59" },
  });
  const errored = r.status !== 200 || Boolean(r.body?.error) || r.body?.result?.isError;
  check("add_item answers", !errored, errored ? JSON.stringify(r.body ?? r.raw).slice(0, 160) : "");
  const { rows } = await pool.query(
    "select title, kind, due_at from events where user_id=$1 and title='MCP smoke task'",
    [userId],
  );
  check("add_item reached the database", rows.length === 1, JSON.stringify(rows[0]));
}

await pool.end();
console.log(`\n${problems.length === 0 ? "MCP surface healthy." : `${problems.length} problem(s):`}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
