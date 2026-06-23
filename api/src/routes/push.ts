/* Abonnement aux rappels d'émission (Web Push). Public : un visiteur s'abonne
   depuis le site. Inactif tant que VAPID non configuré (clé publique vide). */

import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { pushSubscriptions } from "../db/schema.js";
import { env, isPushConfigured } from "../env.js";
import type { AppBindings } from "../types.js";

export const pushRoutes = new Hono<AppBindings>();

/* GET /v1/push/vapid-public-key — clé publique pour s'abonner côté navigateur. */
pushRoutes.get("/push/vapid-public-key", (c) => {
  return c.json({ key: env.VAPID_PUBLIC_KEY, enabled: isPushConfigured() });
});

const subSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(200) }),
  clientId: z.string().max(64).nullish(),
  showSlug: z.string().max(120).nullish(),
});

/* POST /v1/push/subscribe — enregistre (ou met à jour) un abonnement. */
pushRoutes.post("/push/subscribe", async (c) => {
  if (!isPushConfigured()) return c.json({ error: { code: "push_disabled", message: "Push non activé" } }, 503);
  const body = subSchema.parse(await c.req.json());
  await db
    .insert(pushSubscriptions)
    .values({
      radioId: c.get("radioId") ?? null,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      clientId: body.clientId ?? null,
      showSlug: body.showSlug ?? null,
      userAgent: c.req.header("User-Agent") ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: body.keys.p256dh, auth: body.keys.auth, showSlug: body.showSlug ?? null },
    });
  return c.json({ ok: true });
});

/* POST /v1/push/unsubscribe — retire un abonnement. */
pushRoutes.post("/push/unsubscribe", async (c) => {
  const body = z.object({ endpoint: z.string().url().max(1000) }).parse(await c.req.json());
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, body.endpoint));
  return c.json({ ok: true });
});
