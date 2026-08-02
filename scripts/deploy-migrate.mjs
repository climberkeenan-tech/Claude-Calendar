/**
 * Apply migrations during a Vercel build, before the app is built.
 *
 * Without this, a fresh deploy comes up against an empty database and every
 * page 500s — which looks like a broken app rather than a missing step. Any
 * later update that adds a table has the same problem, so this runs on every
 * deploy and applies only what's missing.
 *
 * It fails the build rather than deploying something that can't work, and it
 * says why in words the owner can act on. Locally, `npm run build` is
 * untouched — this only runs under Vercel's `vercel-build`.
 */
import { spawnSync } from "node:child_process";

const url = process.env.DATABASE_URL;

if (!url) {
  console.error(
    "\n  Can't set up the database: DATABASE_URL isn't set.\n\n" +
      "  In Vercel: Storage -> add a Neon database, or paste the connection\n" +
      "  string into Settings -> Environment Variables as DATABASE_URL.\n",
  );
  process.exit(1);
}

/**
 * Migrate over the DIRECT connection, not the pooled one.
 *
 * Neon's Vercel integration sets DATABASE_URL to a PgBouncer endpoint and
 * DATABASE_URL_UNPOOLED to the database itself. PgBouncer in transaction mode
 * doesn't support session-level state — advisory locks, SET, prepared
 * statements — which is exactly what a migration runner leans on, and Neon's
 * own guidance is to use the direct connection for schema changes. The app
 * itself still wants the pooled one at runtime; this override is scoped to
 * the migration and goes no further.
 */
const direct = process.env.DATABASE_URL_UNPOOLED?.trim();
const migrateEnv = { ...process.env };
if (direct) {
  migrateEnv.DATABASE_URL = direct;
  console.log("Using the direct (unpooled) connection for migrations.");
}

console.log("Applying database migrations...");
const migrate = spawnSync("npx", ["drizzle-kit", "migrate"], {
  stdio: "inherit",
  env: migrateEnv,
});

if (migrate.status !== 0) {
  console.error(
    "\n  The database couldn't be set up, so the deploy is stopping here\n" +
      "  rather than putting up a site that can't load.\n\n" +
      "  Usually this means DATABASE_URL is wrong or the database is asleep.\n" +
      "  Check it in Vercel -> Settings -> Environment Variables, then redeploy.\n",
  );
  process.exit(migrate.status ?? 1);
}

console.log("Database ready. Building...");
const build = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  env: process.env,
});
process.exit(build.status ?? 1);
