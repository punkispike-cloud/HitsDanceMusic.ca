/* Pool PostgreSQL + instance Drizzle partagée.
 *
 * Isolation multi-tenant (RLS) : pendant une requête HTTP, le middleware tenant
 * pose `app.radio_id` sur un client dédié et enregistre ce Drizzle dans un
 * AsyncLocalStorage. L'export `db` est un Proxy qui préfère ce client — les
 * `import { db }` existants (routes + services) voient donc la GUC sans changer
 * chaque signature. Hors requête (jobs, boot, audit after-release) → pool global
 * (GUC vide = tout visible tant que le rôle n'est pas enondes_app). */

import { AsyncLocalStorage } from "node:async_hooks";
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

const globalDb = drizzle(pool, { schema });

type Db = typeof globalDb;

const requestDbAls = new AsyncLocalStorage<Db>();

/** Exécute `fn` avec `reqDb` comme cible de l'export `db` (Proxy / ALS). */
export function runWithRequestDb<T>(reqDb: Db, fn: () => Promise<T> | T): Promise<T> | T {
  return requestDbAls.run(reqDb, fn);
}

/** Drizzle courant : client requête (GUC posée) si présent, sinon pool global. */
export const db: Db = new Proxy(globalDb, {
  get(_target, prop, receiver) {
    const current = requestDbAls.getStore() ?? globalDb;
    const value = Reflect.get(current, prop, receiver);
    return typeof value === "function" ? value.bind(current) : value;
  },
}) as Db;

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
