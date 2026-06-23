/* Historique des titres diffusés (lecture admin). Monté sous /v1/admin/tracks,
   donc déjà protégé par requireAuth. */

import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { trackHistory } from "../db/schema.js";
import { requireRadioId } from "../services/tenant.js";
import type { AppBindings } from "../types.js";

export const nowPlayingRoutes = new Hono<AppBindings>();

/* GET /v1/admin/tracks/recent?limit=50 — derniers titres passés à l'antenne. */
nowPlayingRoutes.get("/recent", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 50));
  const rows = await db
    .select()
    .from(trackHistory)
    .where(eq(trackHistory.radioId, radioId))
    .orderBy(desc(trackHistory.playedAt))
    .limit(limit);
  return c.json(rows);
});
