import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Integration tests run against a REAL Postgres, so they live in their own
 * project rather than the default suite: `npm test` must stay runnable with no
 * database anywhere. See tests/integration/setup.ts.
 *
 * A loopback DATABASE_URL is what switches src/lib/db/client.ts onto the plain
 * `pg` driver; INTEGRATION_DATABASE_URL is just a more explicit way to say it.
 */
process.env.DATABASE_URL =
  process.env.INTEGRATION_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://verify:verify@localhost:5432/verifydb";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // One database, shared fixtures: parallel files would truncate each
    // other's rows mid-assertion.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
