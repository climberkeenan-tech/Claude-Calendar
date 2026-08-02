/**
 * One command for the whole runtime verification (dev tooling).
 *
 * The app has three layers of check and only the first runs anywhere:
 *
 *   npm test              pure logic, no database
 *   npm run test:integration   real queries against a real Postgres
 *   node scripts/verify-all.mjs   the running app, in a real browser
 *
 * This is the third. It exists because the second cannot catch a server
 * action that throws the moment it is invoked — which is exactly how quick
 * add shipped returning 500 on every save while 284 tests passed.
 *
 * Expects the app already built and served against the same loopback
 * DATABASE_URL. See docs/SETUP.md.
 */
import { spawn } from "node:child_process";
import { assertLocal } from "./seed-local.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
assertLocal(process.env.DATABASE_URL);

// Order matters a little: the UI sweep seeds the fixtures the others read.
const SCRIPTS = [
  ["verify-ui.mjs", "every route, light/dark, desktop/phone, with axe"],
  ["smoke-flows.mjs", "quick add, completion, habits, timer, feed"],
  ["smoke-recurring.mjs", "the three recurring edit scopes"],
  ["smoke-reminders.mjs", "reminder jobs survive a re-sync"],
  ["smoke-plan.mjs", "plan accept, undo, and the replan sweep"],
  ["smoke-import.mjs", "syllabus approve and undo"],
  ["smoke-actions.mjs", "every remaining server action, called once"],
  ["smoke-mcp.mjs", "the MCP protocol surface"],
  ["smoke-memory.mjs", "what the app remembers, written and read from both sides"],
  ["smoke-login.mjs", "the real sign-in form, right password and wrong"],
];

// Fail fast and clearly if nothing is listening, rather than 30s per script.
try {
  const res = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`status ${res.status}`);
} catch (err) {
  console.error(
    `Nothing serving at ${BASE} (${String(err).slice(0, 60)}).\n` +
      "Build and start the app against the same local DATABASE_URL first.\n" +
      "Restart it after any rebuild — `next start` serves from .next, and\n" +
      "rebuilding underneath a running server breaks its chunk manifest.",
  );
  process.exit(1);
}

const run = (file) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [new URL(file, import.meta.url).pathname], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });

const results = [];
for (const [file, what] of SCRIPTS) {
  console.log(`\n──── ${file} — ${what}`);
  const { code, out } = await run(file);
  process.stdout.write(out.trimEnd() + "\n");
  results.push({ file, ok: code === 0 });
}

console.log("\n════ summary ════");
for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.file}`);
const failed = results.filter((r) => !r.ok);
console.log(
  failed.length === 0
    ? `\nAll ${results.length} runtime checks passed.`
    : `\n${failed.length} of ${results.length} failed.`,
);
process.exit(failed.length === 0 ? 0 : 1);
