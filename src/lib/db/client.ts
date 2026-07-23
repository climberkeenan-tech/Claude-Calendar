import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Point it at your Neon Postgres database.",
  );
}

export const db = drizzle(neon(url), { schema });
export type Db = typeof db;
