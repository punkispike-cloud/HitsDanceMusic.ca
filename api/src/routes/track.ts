/* Ingestion analytics publique (beacons du front). Capture l'IP côté serveur.
   Pas d'auth (visiteurs anonymes), mais validé + borné + rate-limité au montage.

   Garde anti-pollution (A3) : le front est un site statique → impossible d'y
   embarquer un secret pour signer les beacons. La défense réaliste est donc
   serveur : caper la CRÉATION de nouvelles sessions par IP (un bot qui génère
   des clientId aléatoires pour gonfler l'audience). Les heartbeats/listens
   d'une session déjà connue restent illimités (trafic légitime). In-memory,
   mono-instance (dette C3 documentée). */

import { Hono } from "hono";
import { z } from "zod";
import { ingestTrack } from "../services/analytics.js";
import { emitAnalyticsBeacon } from "../services/analytics-bus.js";
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

/* ─────────── Garde anti-pollution (création de sessions par IP) ───────────
   Un visiteur réel crée 1 session (1 pageview). On autorise jusqu'à
   MAX_NEW_SESSIONS_PER_IP_MIN nouvelles sessions par IP et par minute —
   généreux pour un NAT/VPN partagé — au-delà on ignore silencieusement les
   beacons portant un clientId inconnu pour cette IP. Les beacons d'une
   session déjà établie (heartbeat/listen) passent toujours. */
const MAX_NEW_SESSIONS_PER_IP_MIN = 10;
const KNOWN_CAP = 50_000; // borne mémoire du cache des sessions connues

const _knownSessions = new Set<string>(); // clé `${ip}\0${clientId}`
const _newByIp = new Map<string, { windowStart: number; count: number }>();

// Purge périodique : buckets minute expirés + éviction FIFO du cache connus.
const _sweep = setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of _newByIp) {
    if (now - b.windowStart > 60_000) _newByIp.delete(ip);
  }
  if (_knownSessions.size > KNOWN_CAP) {
    let n = 0;
    for (const k of _knownSessions) {
      _knownSessions.delete(k);
      if (++n >= 25_000) break;
    }
  }
}, 120_000);
_sweep.unref?.();

/** Renvoie true si le beacon doit être accepté (session connue ou quota
 *  de nouvelles sessions non dépassé pour cette IP). */
function beaconAllowed(ip: string, clientId: string): boolean {
  const key = `${ip}\0${clientId}`;
  if (_knownSessions.has(key)) return true; // session établie → toujours ok

  const now = Date.now();
  let b = _newByIp.get(ip);
  if (!b || now - b.windowStart > 60_000) {
    b = { windowStart: now, count: 0 };
    _newByIp.set(ip, b);
  }
  b.count++;
  if (b.count > MAX_NEW_SESSIONS_PER_IP_MIN) return false; // quota dépassé → drop

  _knownSessions.add(key);
  return true;
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

  const ip = clientIp(c.req.raw.headers);
  // Garde anti-pollution : on ignore silencieusement (204) les beacons
  // d'un bot qui crée des sessions au-delà du quota IP. Même réponse qu'un
  // beacon accepté → aucune fuite d'information sur le filtrage.
  if (!beaconAllowed(ip, parsed.data.clientId)) return c.body(null, 204);

  try {
    await ingestTrack({
      ...parsed.data,
      radioId,
      ip,
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
