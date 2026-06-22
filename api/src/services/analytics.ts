/* Ingestion analytics : upsert de session visiteur + cumul du temps actif /
   temps d'écoute par émission. Conçu pour des « beacons » légers envoyés par
   le front (pageview, heartbeat, listen). Valeurs bornées côté serveur. */

import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { analyticsSessions, analyticsShowListen } from "../db/schema.js";

// Bornes anti-abus : un beacon ne peut pas ajouter plus que l'intervalle prévu.
const MAX_SECONDS_PER_BEACON = 60;

// Géo-IP best-effort : une seule tentative par visiteur et par process.
const _geoAttempted = new Set<string>();
const PRIVATE_IP = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|inconnue)/i;

/** Un appel HTTP géo borné dans le temps ; renvoie le JSON ou null (best-effort). */
async function fetchGeoJson(url: string): Promise<Record<string, unknown> | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Résout { ville, pays } via des fournisseurs gratuits HTTPS sans clé.
    geojs.io en premier (ville + pays), freeipapi.com en repli.
    (ipwho.is a fermé son offre gratuite → 403 "CORS not supported on Free plan".) */
async function lookupGeo(ip: string): Promise<{ city?: string; country?: string } | null> {
  const enc = encodeURIComponent(ip);
  // 1) geojs.io → { city, country }
  const g = await fetchGeoJson(`https://get.geojs.io/v1/ip/geo/${enc}.json`);
  if (g && (g.city || g.country)) {
    return { city: g.city as string | undefined, country: g.country as string | undefined };
  }
  // 2) repli : freeipapi.com → { cityName, countryName }
  const f = await fetchGeoJson(`https://freeipapi.com/api/json/${enc}`);
  if (f && (f.cityName || f.countryName)) {
    return { city: f.cityName as string | undefined, country: f.countryName as string | undefined };
  }
  return null;
}

async function resolveCountry(ip: string, clientId: string): Promise<void> {
  if (!ip || PRIVATE_IP.test(ip)) return;
  try {
    const geo = await lookupGeo(ip);
    const parts = [geo?.city, geo?.country].filter(
      (s): s is string => typeof s === "string" && !!s,
    );
    if (parts.length) {
      await db
        .update(analyticsSessions)
        .set({ ipCountry: parts.join(", ").slice(0, 120) })
        .where(eq(analyticsSessions.clientId, clientId));
    }
  } catch {
    /* best effort — on ne bloque jamais l'ingestion */
  }
}

function clampSec(n: unknown): number {
  const v = Math.floor(Number(n) || 0);
  if (v <= 0) return 0;
  return Math.min(v, MAX_SECONDS_PER_BEACON);
}

/** Parse rudimentaire du User-Agent → navigateur + type d'appareil. */
export function parseUserAgent(ua: string): { browser: string; device: string } {
  const s = ua || "";
  let browser = "Autre";
  if (/Edg\//.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/.test(s)) browser = "Opera";
  else if (/Chrome\//.test(s) && !/Chromium/.test(s)) browser = "Chrome";
  else if (/Firefox\//.test(s)) browser = "Firefox";
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = "Safari";
  const device = /Mobi|Android|iPhone|iPad|iPod/.test(s) ? "Mobile" : "Ordinateur";
  return { browser, device };
}

export interface TrackInput {
  clientId: string;
  type: "pageview" | "heartbeat" | "listen";
  showTitle?: string;
  seconds?: number;
  ip: string;
  userAgent: string;
}

export async function ingestTrack(input: TrackInput): Promise<void> {
  const { clientId, type, ip, userAgent } = input;
  const { browser, device } = parseUserAgent(userAgent);
  const now = new Date();

  const activeAdd = type === "heartbeat" || type === "listen" ? clampSec(input.seconds) : 0;
  const listenAdd = type === "listen" ? clampSec(input.seconds) : 0;
  const pageAdd = type === "pageview" ? 1 : 0;

  // Upsert de la session (par client_id). On rafraîchit IP/UA à chaque beacon.
  await db
    .insert(analyticsSessions)
    .values({
      clientId,
      ip,
      userAgent,
      browser,
      device,
      firstSeen: now,
      lastSeen: now,
      activeSec: activeAdd,
      listenSec: listenAdd,
      pageViews: pageAdd,
    })
    .onConflictDoUpdate({
      target: analyticsSessions.clientId,
      set: {
        ip,
        userAgent,
        browser,
        device,
        lastSeen: now,
        activeSec: sql`${analyticsSessions.activeSec} + ${activeAdd}`,
        listenSec: sql`${analyticsSessions.listenSec} + ${listenAdd}`,
        pageViews: sql`${analyticsSessions.pageViews} + ${pageAdd}`,
      },
    });

  // Géo-IP : une tentative par visiteur (asynchrone, n'attend pas).
  if (!_geoAttempted.has(clientId)) {
    // Borne mémoire : le Set est purgé s'il devient trop gros (un nouveau
    // visiteur déjà résolu sera juste re-tenté une fois — sans gravité).
    if (_geoAttempted.size > 20_000) _geoAttempted.clear();
    _geoAttempted.add(clientId);
    void resolveCountry(ip, clientId);
  }

  // Temps d'écoute par émission (agrégat par paire émission/visiteur).
  if (listenAdd > 0 && input.showTitle) {
    const showTitle = input.showTitle.slice(0, 200);
    await db
      .insert(analyticsShowListen)
      .values({ showTitle, clientId, listenSec: listenAdd, lastAt: now })
      .onConflictDoUpdate({
        target: [analyticsShowListen.showTitle, analyticsShowListen.clientId],
        set: {
          listenSec: sql`${analyticsShowListen.listenSec} + ${listenAdd}`,
          lastAt: now,
        },
      });
  }
}
