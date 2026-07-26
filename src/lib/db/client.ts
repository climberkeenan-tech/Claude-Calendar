import { createRequire } from "node:module";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Point it at your Neon Postgres database.",
  );
}

type NeonDb = ReturnType<typeof drizzleNeon<typeof schema>>;

/**
 * Production is Neon over HTTP, and that is the only driver this app ships.
 *
 * But neon-http speaks Neon's HTTP protocol, not the Postgres wire protocol,
 * so it cannot talk to a normal Postgres on localhost — which meant the app
 * could not be RUN anywhere except Vercel, and every one of the ~6.5k lines
 * that touch the database went unexercised by anything. A loopback
 * DATABASE_URL therefore gets a plain `pg` connection instead.
 *
 * The branch is on the HOSTNAME, deliberately, not on NODE_ENV or a flag:
 * a Neon connection string never points at localhost, so production cannot
 * take this path by accident or misconfiguration. `pg` is a devDependency and
 * is required lazily, so a production install neither ships it nor loads it.
 */
function isLoopback(u: string): boolean {
  try {
    const h = new URL(u).hostname;
    return (
      h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]"
    );
  } catch {
    return false;
  }
}

/**
 * A local stand-in with the same surface the app uses, including `batch`.
 *
 * `db.batch` is the ONLY atomic unit available on neon-http (db.transaction
 * throws there), and a lot of correctness rests on it — a half-applied event
 * split or syllabus undo is exactly the failure this codebase spends its
 * comments on. So the shim is a real transaction, not a for-loop: each
 * statement is rendered with .toSQL() and replayed on one pooled connection
 * between BEGIN and COMMIT, rolling back as a unit. Local behaviour therefore
 * matches production instead of quietly being weaker than it.
 */
function localDb(connectionString: string): NeonDb {
  const require = createRequire(import.meta.url);
  const { Pool } = require("pg") as typeof import("pg");
  const { drizzle } = require("drizzle-orm/node-postgres") as typeof import("drizzle-orm/node-postgres");

  const pool = new Pool({ connectionString });
  const base = drizzle(pool, { schema });

  type Renderable = { toSQL: () => { sql: string; params: unknown[] } };
  const batch = async (statements: Renderable[]) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const out: unknown[] = [];
      for (const s of statements) {
        const { sql, params } = s.toSQL();
        const res = await client.query(sql, params as never[]);
        out.push(res.rows);
      }
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };

  return Object.assign(base, { batch }) as unknown as NeonDb;
}

export const db: NeonDb = isLoopback(url)
  ? localDb(url)
  : drizzleNeon(neon(url), { schema });
export type Db = typeof db;
