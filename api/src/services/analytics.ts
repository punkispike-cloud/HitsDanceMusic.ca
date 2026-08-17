/* Ingestion analytics : upsert de session visiteur + cumul du temps actif /
   temps d'écoute par émission. Conçu pour des « beacons » légers envoyés par
   le front (pageview, heartbeat, listen). Valeurs bornées côté serveur. */

import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { analyticsSessions, analyticsShowListen } from "../db/schema.js";
import { isGeoipConfigured } from "../env.js";
import { resolveGeoMmdbPath } from "../lib/geo-db.js";

// Bornes anti-abus : un beacon ne peut pas ajouter plus que l'intervalle prévu.
const MAX_SECONDS_PER_BEACON = 60;

/* Fuseau des agrégats quotidiens. Identique à celui de analytics-admin.ts :
   « aujourd'hui » doit vouloir dire la même chose à l'écriture et à la lecture. */
const RADIO_TZ = "America/Toronto";

// Géo-IP : une tentative par visiteur et par process. Lookup LOCAL via MMDB
// (MaxMind ou DB-IP City Lite). Aucun IP visiteur n'est envoyé à un tiers
// (audit A5). Désactiver : GEOIP_DISABLED=1.
const _geoAttempted = new Set<string>();
const PRIVATE_IP = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|inconnue)/i;

type GeoResult = { city?: string; country?: string; lat?: number; lon?: number };

// Reader MaxMind en cache (singleton, chargé paresseusement). Null si la config
// est absente ou l'ouverture échoue.
type GeoReader = { get(ip: string): unknown } | null;
let geoReader: GeoReader | null | undefined;

async function getGeoReader(): Promise<GeoReader | null> {
  if (geoReader !== undefined) return geoReader;
  if (!isGeoipConfigured()) {
    geoReader = null;
    return null;
  }
  try {
    const path = await resolveGeoMmdbPath();
    if (!path) {
      geoReader = null;
      return null;
    }
    const { default: maxmind } = await import("maxmind");
    geoReader = (await maxmind.open(path)) as GeoReader;
  } catch (err) {
    console.error("[analytics] échec ouverture MMDB — géo désactivée", err);
    geoReader = null;
  }
  return geoReader;
}

/** Résout { ville, pays, lat, lon } via la base locale MaxMind. Null si
 *  inactif ou IP introuvable. Aucun appel réseau (lookup fichier local). */
async function lookupGeo(ip: string): Promise<GeoResult | null> {
  const reader = await getGeoReader();
  if (!reader) return null;
  const g = reader.get(ip) as
    | {
        country?: { names?: { en?: string; fr?: string } } | string;
        city?: { names?: { en?: string; fr?: string } } | string;
        location?: { latitude?: number; longitude?: number };
      }
    | null;
  if (!g) return null;
  const nameOf = (v: { names?: { en?: string; fr?: string } } | string | undefined) =>
    typeof v === "string" ? v : v?.names?.fr || v?.names?.en;
  return {
    city: nameOf(g.city),
    country: nameOf(g.country),
    lat: g.location?.latitude,
    lon: g.location?.longitude,
  };
}

async function resolveCountry(ip: string, clientId: string, radioId: string): Promise<void> {
  if (!ip || PRIVATE_IP.test(ip)) return;
  try {
    const geo = await lookupGeo(ip);
    if (!geo) return;
    const parts = [geo.city, geo.country].filter(
      (s): s is string => typeof s === "string" && !!s,
    );
    const patch: { ipCountry?: string; ipLat?: number; ipLon?: number } = {};
    if (parts.length) patch.ipCountry = parts.join(", ").slice(0, 120);
    if (geo.lat !== undefined && geo.lon !== undefined) {
      patch.ipLat = geo.lat;
      patch.ipLon = geo.lon;
    }
    if (Object.keys(patch).length) {
      await db
        .update(analyticsSessions)
        .set(patch)
        .where(and(eq(analyticsSessions.radioId, radioId), eq(analyticsSessions.clientId, clientId)));
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
  radioId: string;
  clientId: string;
  type: "pageview" | "heartbeat" | "listen";
  showTitle?: string;
  seconds?: number;
  ip: string;
  userAgent: string;
}

/* Upsert de la session (par client_id), avec PLAFONNEMENT au temps réellement
   écoulé. Le client annonce des secondes ; on n'en crédite jamais plus que ce
   qui s'est écoulé depuis le dernier beacon ayant crédité le même type de temps.
   Sans ce plafond, deux fenêtres ouvertes en parallèle (même client_id, timers
   décalés) créditaient chacune son intervalle → 2 × le temps réel sur « temps
   sur le site ».

   Deux repères distincts (last_active_at / last_listen_at) : avec un seul, le
   heartbeat d'une fenêtre consommerait la seconde d'écoute que la fenêtre qui
   joue s'apprêtait à créditer, et « temps d'écoute » serait sous-estimé.
   Repli sur `first_seen` (et NON `last_seen`, que n'importe quel beacon
   rafraîchit) tant qu'un repère est nul : sinon le premier `listen` arrivant
   après un `heartbeat` serait plafonné à 0, et comme il ne poserait jamais
   `last_listen_at`, l'écoute resterait à zéro pour toujours.

   Le CTE `d` calcule les deltas retenus AVANT l'upsert et la requête les
   renvoie : on les réutilise tels quels pour analytics_daily et
   analytics_show_listen, qui restent ainsi cohérents avec la session.
   (Deux beacons rigoureusement simultanés lisent le même instantané et peuvent
   encore compter double une fois ; à 20 s d'intervalle par onglet, c'est du
   bruit — la dérive systématique, elle, disparaît.)

   Exporté pour que tests/analytics-ingest.test.ts exécute le SQL RÉEL sur un
   Postgres embarqué, plutôt qu'une copie qui dériverait. */
export function sessionUpsertQuery(p: {
  radioId: string;
  clientId: string;
  ip: string;
  userAgent: string;
  browser: string;
  device: string;
  activeReq: number;
  listenReq: number;
  pageAdd: number;
}) {
  const { radioId, clientId, ip, userAgent, browser, device, activeReq, listenReq, pageAdd } = p;
  return sql`
    WITH d AS (
      SELECT
        CASE WHEN p.id IS NULL THEN ${activeReq}
             ELSE LEAST(${activeReq}, GREATEST(0, floor(extract(epoch FROM now() - COALESCE(p.last_active_at, p.first_seen)))::int))
        END AS active_add,
        CASE WHEN p.id IS NULL THEN ${listenReq}
             ELSE LEAST(${listenReq}, GREATEST(0, floor(extract(epoch FROM now() - COALESCE(p.last_listen_at, p.first_seen)))::int))
        END AS listen_add
      FROM (SELECT 1) one
      LEFT JOIN analytics_sessions p
             ON p.radio_id = ${radioId} AND p.client_id = ${clientId}
    ),
    ins AS (
      INSERT INTO analytics_sessions
        (radio_id, client_id, ip, user_agent, browser, device,
         first_seen, last_seen, last_active_at, last_listen_at,
         active_sec, listen_sec, page_views)
      SELECT ${radioId}, ${clientId}, ${ip}, ${userAgent}, ${browser}, ${device},
             now(), now(),
             CASE WHEN d.active_add > 0 THEN now() END,
             CASE WHEN d.listen_add > 0 THEN now() END,
             d.active_add, d.listen_add, ${pageAdd}
      FROM d
      ON CONFLICT (radio_id, client_id) DO UPDATE SET
        ip = EXCLUDED.ip,
        user_agent = EXCLUDED.user_agent,
        browser = EXCLUDED.browser,
        device = EXCLUDED.device,
        last_seen = now(),
        last_active_at = COALESCE(EXCLUDED.last_active_at, analytics_sessions.last_active_at),
        last_listen_at = COALESCE(EXCLUDED.last_listen_at, analytics_sessions.last_listen_at),
        active_sec = analytics_sessions.active_sec + EXCLUDED.active_sec,
        listen_sec = analytics_sessions.listen_sec + EXCLUDED.listen_sec,
        page_views = analytics_sessions.page_views + EXCLUDED.page_views
      RETURNING 1
    )
    SELECT d.active_add AS "activeAdd", d.listen_add AS "listenAdd" FROM d
  `;
}

/* Ventilation quotidienne. On écrit la ligne du jour même quand les deltas sont
   nuls : elle vaut « ce visiteur était là ce jour-là », ce qui est la définition
   du compteur « visiteurs aujourd'hui ». Exporté pour la même raison que
   ci-dessus. */
export function dailyUpsertQuery(p: {
  radioId: string;
  clientId: string;
  activeAdd: number;
  listenAdd: number;
  pageAdd: number;
}) {
  const { radioId, clientId, activeAdd, listenAdd, pageAdd } = p;
  return sql`
    INSERT INTO analytics_daily (radio_id, day, client_id, active_sec, listen_sec, page_views)
    VALUES (
      ${radioId},
      (now() AT TIME ZONE ${RADIO_TZ}::text)::date,
      ${clientId},
      ${activeAdd}, ${listenAdd}, ${pageAdd}
    )
    ON CONFLICT (radio_id, day, client_id) DO UPDATE SET
      active_sec = analytics_daily.active_sec + EXCLUDED.active_sec,
      listen_sec = analytics_daily.listen_sec + EXCLUDED.listen_sec,
      page_views = analytics_daily.page_views + EXCLUDED.page_views
  `;
}

export async function ingestTrack(input: TrackInput): Promise<void> {
  const { clientId, type, ip, userAgent, radioId } = input;
  const { browser, device } = parseUserAgent(userAgent);

  const activeReq = type === "heartbeat" || type === "listen" ? clampSec(input.seconds) : 0;
  const listenReq = type === "listen" ? clampSec(input.seconds) : 0;
  const pageAdd = type === "pageview" ? 1 : 0;

  const upserted = await db.execute(
    sessionUpsertQuery({ radioId, clientId, ip, userAgent, browser, device, activeReq, listenReq, pageAdd }),
  );

  const applied = upserted.rows[0] as { activeAdd: number; listenAdd: number } | undefined;
  const activeAdd = Number(applied?.activeAdd ?? 0);
  const listenAdd = Number(applied?.listenAdd ?? 0);

  await db.execute(dailyUpsertQuery({ radioId, clientId, activeAdd, listenAdd, pageAdd }));

  // Géo-IP : une tentative par visiteur (asynchrone, n'attend pas).
  if (!_geoAttempted.has(clientId)) {
    // Borne mémoire : éviction FIFO PARTIELLE (les plus anciens) plutôt qu'un
    // clear total — sinon tous les visiteurs déjà résolus seraient re-tentés,
    // déclenchant une rafale d'appels vers les fournisseurs géo gratuits.
    if (_geoAttempted.size > 20_000) {
      let n = 0;
      for (const k of _geoAttempted) {
        _geoAttempted.delete(k);
        if (++n >= 10_000) break;
      }
    }
    _geoAttempted.add(clientId);
    void resolveCountry(ip, clientId, radioId);
  }

  // Temps d'écoute par émission (agrégat par paire émission/visiteur). On
  // reporte le delta RETENU, pas celui annoncé par le client : sinon l'écoute
  // par émission dépasserait l'écoute totale de la session.
  if (listenAdd > 0 && input.showTitle) {
    const showTitle = input.showTitle.slice(0, 200);
    const now = new Date();
    await db
      .insert(analyticsShowListen)
      .values({ radioId, showTitle, clientId, listenSec: listenAdd, lastAt: now })
      .onConflictDoUpdate({
        target: [analyticsShowListen.radioId, analyticsShowListen.showTitle, analyticsShowListen.clientId],
        set: {
          listenSec: sql`${analyticsShowListen.listenSec} + ${listenAdd}`,
          lastAt: now,
        },
      });
  }
}
