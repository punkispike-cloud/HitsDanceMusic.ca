/* Envoi manuel de notifications + statistiques d'abonnés (console admin).
   Monté sous /v1/admin/push → déjà protégé par requireAuth. */

import { Hono } from "hono";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { pushSubscriptions } from "../db/schema.js";
import { requireMinRole } from "../middleware/rbac.js";
import { notifyShow } from "../services/push.js";
import { isPushConfigured } from "../env.js";
import type { AppBindings } from "../types.js";

export const pushAdminRoutes = new Hono<AppBindings>();

pushAdminRoutes.get("/stats", async (c) => {
  const [agg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      global: sql<number>`count(*) filter (where ${pushSubscriptions.showSlug} is null)::int`,
    })
    .from(pushSubscriptions);
  return c.json({ enabled: isPushConfigured(), total: agg?.total ?? 0, global: agg?.global ?? 0 });
});

const notifySchema = z.object({
  showSlug: z.string().max(120).nullish(),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(300),
  url: z.string().url().max(500).optional(),
});

/* POST /v1/admin/push/notify — diffuse une notification (superadmin). */
pushAdminRoutes.post("/notify", requireMinRole("superadmin"), async (c) => {
  if (!isPushConfigured()) return c.json({ error: { code: "push_disabled", message: "Push non activé" } }, 503);
  const body = notifySchema.parse(await c.req.json());
  const sent = await notifyShow(body.showSlug ?? "__all__", {
    title: body.title,
    body: body.body,
    url: body.url,
    tag: "annonce",
  });
  return c.json({ ok: true, sent });
});
