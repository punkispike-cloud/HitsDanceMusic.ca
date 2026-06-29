/* Rate limiting.
   - globalRateLimit : en mémoire (Map par instance), fenêtre glissante par minute.
     Suffisant pour le trafic public (borne large, best-effort) ; non partagé entre
     instances → admet une borne souple en multi-instance.
   - authRateLimit : Postgres-backed (table rate_buckets), partagé entre instances
     (C1.3). Cible UNIQUEMENT /auth/* : protection anti brute-force, faible volume
     (10 rpm) → une requête DB par tentative de login est un coût acceptable. La
     fenêtre est fixe par minute (key = `auth:<ip>:<minute>`) via un upsert atomique.

   Arbitrage fail-open : si la DB est indisponible au moment de la requête, on
   laisse passer (disponibilité de l'auth privilégiée sur la borne). Le risque
   (désactivation transitoire de la borne brute-force lors d'une panne DB) est
   documenté ; la borne in-memory globale reste active par instance. */

import type { MiddlewareHandler } from "hono";
import { tooMany } from "../lib/errors.js";
import { pool } from "../db/client.js";

interface Bucket {
  windowStart: number;
  count: number;
}

function makeLimiter(limitPerMinute: number, keyPrefix: string): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();

  // Purge périodique des buckets expirés (évite la fuite mémoire).
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (now - b.windowStart > 60_000) buckets.delete(k);
    }
  }, 120_000);
  sweep.unref?.();

  return async (c, next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "unknown";
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.windowStart > 60_000) {
      b = { windowStart: now, count: 0 };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > limitPerMinute) {
      const retry = Math.ceil((b.windowStart + 60_000 - now) / 1000);
      c.header("Retry-After", String(Math.max(1, retry)));
      throw tooMany();
    }
    await next();
  };
}

export const globalRateLimit = (rpm: number) => makeLimiter(rpm, "global");

/** Extrait l'IP cliente derrière le proxy Railway (commun aux deux limiteurs). */
function clientIp(c: Parameters<MiddlewareHandler>[0]): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown"
  );
}

/** Rate-limit des endpoints /auth/* : Postgres-backed, partagé entre instances. */
export const authRateLimit = (rpm: number): MiddlewareHandler => async (c, next) => {
  const ip = clientIp(c);
  const minute = Math.floor(Date.now() / 60_000);
  const key = `auth:${ip}:${minute}`;

  let count = 0;
  let counted = false;
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
    count = (res.rows[0] as { count: number } | undefined)?.count ?? 0;
    counted = true;
  } catch (err) {
    // Fail-open : on ne bloque pas l'auth sur une panne DB. La borne in-memory
    // globale reste active par instance ; le risque brute-force est transitoire.
    console.warn("[rateLimit] auth DB indisponible, fail-open", err);
  }

  if (counted && count > rpm) {
    c.header("Retry-After", "60");
    throw tooMany();
  }
  await next();
};
