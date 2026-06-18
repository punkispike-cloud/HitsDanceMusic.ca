/* Rate limiting en mémoire (fenêtre glissante par minute), calqué sur le
   compteur du service presence (server.js:135-142). Par instance — suffisant
   à cette échelle ; migrable vers Redis si multi-instances plus tard. */

import type { MiddlewareHandler } from "hono";
import { tooMany } from "../lib/errors.js";

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
export const authRateLimit = (rpm: number) => makeLimiter(rpm, "auth");
