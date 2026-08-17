/* Rate limiting — Postgres-backed (table rate_buckets), partagé entre instances.
   Fenêtre fixe par minute (key = `<prefix>:<ip>:<minute>`) via un upsert atomique.

   - globalRateLimit : borne large sur tout le trafic public (app.use("*")).
     Avant 2026-08-16 : compteur en mémoire (Map par instance) → la borne réelle
     était rpm × nb d'instances (audit G6). Désormais exacte en multi-instance,
     au prix d'un upsert par requête (même coût qu'authRateLimit, volume public
     plus élevé mais requête triviale indexée sur la PK).
   - authRateLimit : cible /auth/* (anti brute-force, faible volume).

   Arbitrage fail-open : si la DB est indisponible, on laisse passer. Sans DB,
   les routes métier échouent de toute façon plus loin — la borne ne protège
   rien de ce qui est déjà en panne. */

import type { MiddlewareHandler } from "hono";
import { tooMany } from "../lib/errors.js";
import { pool } from "../db/client.js";

/** Extrait l'IP cliente derrière le proxy Railway (commun aux deux limiteurs). */
function clientIp(c: Parameters<MiddlewareHandler>[0]): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown"
  );
}

/** Incrémente le bucket minute de `key` et renvoie le compte, ou null si la DB
 *  est indisponible (fail-open — voir en-tête). */
async function pgCount(key: string): Promise<number | null> {
  try {
    const res = await pool.query(
      `INSERT INTO rate_buckets (key, count, expires_at)
       VALUES ($1, 1, now() + interval '90 seconds')
       ON CONFLICT (key) DO UPDATE
         SET count = rate_buckets.count + 1,
             expires_at = now() + interval '90 seconds'
       RETURNING count`,
      [key],
    );
    return (res.rows[0] as { count: number } | undefined)?.count ?? null;
  } catch (err) {
    console.warn("[rateLimit] DB indisponible, fail-open", err);
    return null;
  }
}

function makePgLimiter(rpm: number, keyPrefix: string): MiddlewareHandler {
  return async (c, next) => {
    const minute = Math.floor(Date.now() / 60_000);
    const count = await pgCount(`${keyPrefix}:${clientIp(c)}:${minute}`);
    if (count !== null && count > rpm) {
      const retry = 60 - (Math.floor(Date.now() / 1000) % 60);
      c.header("Retry-After", String(Math.max(1, retry)));
      throw tooMany();
    }
    await next();
  };
}

export const globalRateLimit = (rpm: number) => makePgLimiter(rpm, "global");

/** Rate-limit des endpoints /auth/* : partagé entre instances (anti brute-force). */
export const authRateLimit = (rpm: number) => makePgLimiter(rpm, "auth");
