/**
 * Memory smoke (dev tooling — never imported by the app).
 *
 * The whole point of this feature is that something said on Monday is still
 * known on Wednesday, and the only honest way to check that is to write from
 * one side and read from the other: save through the Settings panel, then ask
 * the MCP tools; save through MCP, then look at the panel.
 *
 * It also checks the thing a user would never see failing — that `get_context`
 * actually carries the memories, the classes, and the deadlines. A context
 * tool that quietly returns a header and nothing else looks fine in a test
 * that only asserts status 200.
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

const TYPED = "Smoke: mornings before ten are useless to me";
const VIA_CLAUDE = "Smoke: Dr. Reyes drops the lowest quiz";

const COURSE = "Smoke Organic Chemistry";

// Start from a known-empty slate so counts mean something.
await pool.query("delete from memories where user_id=$1 and text like 'Smoke:%'", [userId]);
// A class of its own rather than one from the shared fixtures — those seed
// events, not courses, and `get_context` reads the courses table. Scoped by
// name so it can be cleaned up without touching anything else.
await pool.query("delete from courses where user_id=$1 and name=$2", [userId, COURSE]);
await pool.query(
  `insert into courses (id,user_id,name,code,professor,location)
   values ($1,$2,$3,'CHM 220','Dr. Reyes','Congdon 210')`,
  [crypto.randomUUID(), userId, COURSE],
);

const memRows = async () =>
  (
    await pool.query(
      "select id, text, kind, source, pinned, last_used_at from memories where user_id=$1 and text like 'Smoke:%' order by created_at",
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

// ============================ the Settings panel =============================
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });

const box = page.locator("#mem-add");
await box.waitFor({ state: "visible", timeout: 20000 });
await box.fill(TYPED);
await page.locator("button").filter({ hasText: /^Remember$/ }).first().click();
await page.waitForTimeout(3000);

let rows = await memRows();
check("typing something in Settings saves it", rows.length === 1, `${rows.length} row(s)`);
check("and it's marked as coming from the owner, not from Claude",
  rows[0]?.source === "user", rows[0]?.source);

// Scoped to the row under test: clicking "the first Pin on the page" is how a
// smoke script passes while doing the wrong thing entirely.
const row = page.locator("li").filter({ hasText: TYPED }).first();
await row.locator("button").filter({ hasText: /^Pin$/ }).first().click();
await page.waitForTimeout(2500);
rows = await memRows();
check("pinning it sticks", rows[0]?.pinned === true, `pinned=${rows[0]?.pinned}`);

// ============================== over MCP =====================================
const gen = page.locator("button", { hasText: "Generate token" }).first();
await gen.click();
await page.waitForTimeout(3000);
const token = (await page.locator("code").allTextContents())
  .map((t) => t.trim())
  .find((t) => t.startsWith("hpos_"));
check("minted a token to ask Claude's side with", Boolean(token));
if (!token) {
  await browser.close();
  await pool.end();
  process.exit(1);
}

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
  const raw = await res.text();
  const line = raw.includes("data:")
    ? raw.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5)
    : raw;
  let body = null;
  try {
    body = JSON.parse(line);
  } catch {
    /* leave null */
  }
  return { status: res.status, body, raw: raw.slice(0, 200) };
}
const say = (r) => (r.body?.result?.content ?? []).map((c) => c.text ?? "").join("\n");
const broke = (r) => r.status !== 200 || Boolean(r.body?.error) || r.body?.result?.isError;

await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});

const listed = await rpc("tools/list", {});
const names = (listed.body?.result?.tools ?? []).map((t) => t.name);
for (const t of ["get_context", "remember", "forget", "list_memories"]) {
  check(`${t} is offered to Claude`, names.includes(t));
}

// --- the read side: does Claude actually receive what the app knows? ---------
const context = await rpc("tools/call", { name: "get_context", arguments: {} });
check("get_context answers", !broke(context), broke(context) ? JSON.stringify(context.body ?? context.raw).slice(0, 200) : "");
const brief = say(context);
check("the brief carries what was typed in Settings", brief.includes(TYPED),
  brief.slice(0, 100).replace(/\n/g, " "));
// Asserted against the ONE line for this course, not against the whole brief:
// other smokes seed courses too, and "the professor appears somewhere in the
// text" would pass on a completely different class.
const courseLine = brief.split("\n").find((l) => l.includes(COURSE)) ?? "";
check("and the classes, with the professor and the room",
  /CHM 220/.test(courseLine) && /Dr\. Reyes/.test(courseLine) && /Congdon 210/.test(courseLine),
  courseLine || "not listed at all");
check("and today, and the deadlines ahead",
  brief.includes("## Today") && brief.includes("## Coming up"));
check("and says the timezone rather than assuming the browser's",
  brief.includes("America/New_York"));

// Reading is what marks a memory used — that's how Settings can show which
// ones are earning their place.
rows = await memRows();
check("reading the context stamps what it used", rows[0]?.last_used_at !== null);

// --- the write side ---------------------------------------------------------
const saved = await rpc("tools/call", {
  name: "remember",
  arguments: { text: VIA_CLAUDE, kind: "fact" },
});
check("remember answers", !broke(saved), broke(saved) ? JSON.stringify(saved.body ?? saved.raw).slice(0, 200) : "");
rows = await memRows();
check("what Claude saved reached the database", rows.length === 2, `${rows.length} row(s)`);
const mine = rows.find((r) => r.text === VIA_CLAUDE);
check("tagged as saved by Claude", mine?.source === "claude", mine?.source);

const again = await rpc("tools/call", {
  name: "remember",
  arguments: { text: `  ${VIA_CLAUDE}  `, kind: "constraint" },
});
check("saying it a second time updates instead of duplicating",
  (await memRows()).length === 2, say(again).slice(0, 60));

const tooShort = await rpc("tools/call", { name: "remember", arguments: { text: "no" } });
check("a fragment is refused rather than stored", broke(tooShort) || /not saved/i.test(say(tooShort)),
  say(tooShort).slice(0, 60));

const listedMems = await rpc("tools/call", { name: "list_memories", arguments: {} });
check("list_memories returns ids to forget with", /\[id: /.test(say(listedMems)));

// --- the owner can see everything Claude saved -------------------------------
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
const panel = await page.locator("main").innerText();
check("what Claude saved is visible in Settings", panel.includes(VIA_CLAUDE),
  "a memory you can't see isn't a feature, it's a surprise");
check("and it says where it came from", /Claude saved/.test(panel));

// --- forgetting, from both sides ---------------------------------------------
const forgot = await rpc("tools/call", { name: "forget", arguments: { id: mine.id } });
check("forget answers", !broke(forgot));
check("and the row is gone", (await memRows()).length === 1);

await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
const survivor = page.locator("li").filter({ hasText: TYPED }).first();
await survivor.locator("button").filter({ hasText: /^Delete$/ }).first().click();
await page.waitForTimeout(2500);
check("deleting from Settings removes it too", (await memRows()).length === 0);

check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await pool.query("delete from memories where user_id=$1 and text like 'Smoke:%'", [userId]);
await pool.query("delete from courses where user_id=$1 and name=$2", [userId, COURSE]);
await pool.end();
await browser.close();
console.log(`\n${problems.length === 0 ? "Memory healthy." : `${problems.length} problem(s):`}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
