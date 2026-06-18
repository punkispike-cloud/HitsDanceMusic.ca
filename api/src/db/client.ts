/* Pool PostgreSQL + instance Drizzle partagée. */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../env.js";
import * as schema from "./schema.js";

const { Pool } = pg;

// SSL : Railway expose la DB via une URL privée (pas de SSL requis en interne).
// Sur une URL publique ou un provider externe, activer SSL si nécessaire.
const needsSsl = /[?&]sslmode=require/.test(env.DATABASE_URL);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("[api] pool postgres error", err);
});

export const db = drizzle(pool, { schema });

/** Vérifie la connectivité DB (utilisé par /health). */
export async function pingDb(): Promise<boolean> {
  try {
    const r = await pool.query("SELECT 1 AS ok");
    return r.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  try {
    await pool.end();
  } catch {
    /* noop */
  }
}
