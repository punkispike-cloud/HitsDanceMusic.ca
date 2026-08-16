/* Ingestion analytics publique (beacons du front). Capture l'IP côté serveur.
   Pas d'auth (visiteurs anonymes), mais validé + borné + rate-limité au montage. */

import { Hono } from "hono";
import { z } from "zod";
import { ingestTrack } from "../services/analytics.js";
import { emitAnalyticsBeacon } from "../services/analytics-bus.js";
import { beaconAllowed } from "../services/beacon-limit.js";
import type { AppBindings } from "../types.js";

export const trackRoutes = new Hono<AppBindings>();

const trackSchema = z.object({
  clientId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(["pageview", "heartbeat", "listen"]),
  showTitle: z.string().max(200).optional(),
  seconds: z.number().int().min(0).max(120).optional(),
});

/** Extrait l'IP réelle derrière le proxy Railway. */
function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip") || "inconnue";
}

/* POST /v1/track — beacon analytics. Répond 204 sans corps (léger). */
trackRoutes.post("/track", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.body(null, 204);
  }
  const parsed = trackSchema.safeParse(body);
  if (!parsed.success) return c.body(null, 204); // on n'expose pas d'erreur aux visiteurs

  const radioId = c.get("radioId");
  if (!radioId) return c.body(null, 204); // hôte non rattaché à une radio → on ignore

  // Anti-abus (audit A3) : plafond par clientId sur 60 s. Un bot réutilisant un
  // même clientId pour injecter de fausses secondes est droppé silencieusement.
  // Un bot générant un clientId neuf à chaque coup reste limité par l'IP (rateLimit
  // global). On répond 204 (léger, ne révèle rien au visiteur).
  if (!beaconAllowed(parsed.data.clientId)) return c.body(null, 204);

  try {
    await ingestTrack({
      ...parsed.data,
      radioId,
      ip: clientIp(c.req.raw.headers),
      userAgent: c.req.header("User-Agent") || "",
    });
    // Notifie les clients SSE admin connectés à cette radio → pousse un instantané
    // immédiat (temps réel) plutôt que d'attendre le tick périodique de 2 s.
    emitAnalyticsBeacon(radioId);
  } catch {
    /* on n'échoue jamais bruyamment côté visiteur */
  }
  return c.body(null, 204);
});
