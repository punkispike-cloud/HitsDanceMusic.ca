/* Lecture des statistiques d'audience (console admin). Monté sous /v1/admin →
   déjà protégé par requireAuth + adminTenant. Tout est filtré par radio :
   chaque radio ne voit QUE son audience. La liste des sessions expose les IP
   (donnée personnelle) → réservée au superadmin. */

import { Hono } from "hono";
import { sql, eq, desc } from "drizzle-orm";
import { db, runWithRequestDb } from "../db/client.js";
import { acquireRequestDb, releaseRequestDb } from "../db/tenant-guc.js";
import { analyticsSessions, analyticsShowListen } from "../db/schema.js";
import { requireRole } from "../middleware/rbac.js";
import { requireRadioId } from "../services/tenant.js";
import { onAnalyticsBeacon } from "../services/analytics-bus.js";
import { TRACK_FILTER_RES, mergeTopTracks, type TopTrackRow } from "../services/track-labels.js";
import type { AppBindings } from "../types.js";

/* Fuseau des agrégats quotidiens — le même qu'à l'ingestion
   (services/analytics.ts), sans quoi « aujourd'hui » ne désignerait pas la même
   journée à l'écriture et à la lecture. */
const RADIO_TZ = "America/Toronto";

export const analyticsAdminRoutes = new Hono<AppBindings>();

/** Échappe une valeur pour une cellule CSV (RFC 4180) + neutralise l'injection
   de formule (Excel/LibreOffice) sur les données d'origine externe. */
function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return "﻿" + lines.join("\r\n"); // BOM → Excel ouvre l'UTF-8 correctement
}

/* GET /v1/admin/analytics/overview — chiffres clés (radio courante). */
analyticsAdminRoutes.get("/overview", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  return c.json(await fetchOverview(radioId));
});

/** Construit l'instantané « overview » (chiffres clés) d'une radio. Partagé entre
 *  GET /overview et le stream SSE → une seule source de vérité pour les chiffres. */
async function fetchOverview(radioId: string) {
  const [agg] = await db
    .select({
      totalSessions: sql<number>`count(*)::int`,
      live: sql<number>`count(*) filter (where ${analyticsSessions.lastSeen} > now() - interval '60 seconds')::int`,
      sumActive: sql<number>`coalesce(sum(${analyticsSessions.activeSec}),0)::int`,
      sumListen: sql<number>`coalesce(sum(${analyticsSessions.listenSec}),0)::int`,
      pageViews: sql<number>`coalesce(sum(${analyticsSessions.pageViews}),0)::int`,
    })
    .from(analyticsSessions)
    .where(eq(analyticsSessions.radioId, radioId));

  /* « Visiteurs aujourd'hui » = visiteurs distincts ayant une ligne du jour dans
     analytics_daily. Se lit sur la MÊME table que /timeseries → la carte et la
     première barre du graphique disent forcément la même chose. Le jour est
     calculé au fuseau de la radio : `date_trunc('day', now())` utiliserait le
     fuseau de session (UTC), et minuit UTC = 19 h/20 h la veille à Toronto. */
  const todayRes = await db.execute(sql`
    SELECT count(*)::int AS "today"
    FROM analytics_daily
    WHERE radio_id = ${radioId}
      AND day = (now() AT TIME ZONE ${RADIO_TZ}::text)::date
  `);
  const today = Number((todayRes.rows[0] as { today?: number } | undefined)?.today ?? 0);

  const total = agg?.totalSessions ?? 0;
  return {
    totalSessions: total,
    live: agg?.live ?? 0,
    today,
    pageViews: agg?.pageViews ?? 0,
    totalActiveSec: agg?.sumActive ?? 0,
    totalListenSec: agg?.sumListen ?? 0,
    avgActiveSec: total ? Math.round((agg!.sumActive ?? 0) / total) : 0,
    avgListenSec: total ? Math.round((agg!.sumListen ?? 0) / total) : 0,
  };
}

/* GET /v1/admin/analytics/stream — flux SSE temps réel (radio courante). Pousse
   un instantané {overview, geo, sessions?} :
   - immédiatement à l'ouverture,
   - à chaque beacon reçu pour cette radio (même instance API → quasi-instantané),
   - toutes les 2 s en repli (gère le vieillissement des sessions hors fenêtre 60 s
     + la fraîcheur multi-instance où l'événement beacon ne traverse pas les replicas).
   `sessions` (IP) n'est inclus QUE pour superadmin + owner (même garde que
   /sessions). Auth réutilisée : requireAuth + adminTenant déjà appliqués sur
   /v1/admin/*. Le client lit ce flux via fetch streaming (EventSource ne peut pas
   envoyer l'en-tête Authorization). */
analyticsAdminRoutes.get("/stream", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const user = c.get("user");
  const includeSessions = user?.role === "superadmin" || user?.role === "owner";

  const enc = new TextEncoder();
  let closed = false;
  const timers: ReturnType<typeof setInterval>[] = [];
  let offBeacon: (() => void) | null = null;

  // Démontage partagé (timers + listener bus). Idempotent. Appelé par le repli
  // canonique `cancel()` du ReadableStream (déclenché par node-server à la
  // déconnexion) ET, en bonus, par un éventuel event "close" (adaptateur node brut).
  const teardown = () => {
    if (closed) return;
    closed = true;
    for (const t of timers) clearInterval(t);
    timers.length = 0;
    offBeacon?.();
    offBeacon = null;
  };

  const snapshot = async (): Promise<string> => {
    // Chaque snapshot s'exécute sur un client du pool dédié + GUC app.radio_id
    // posée (RLS enforced). Le stream lui-même ne retient pas de client entre
    // snapshots : on acquiert/libère par snapshot (durée courte) plutôt que pour
    // toute la vie de la connexion SSE — sinon le pool (max 10) s'épuiserait.
    const { db: reqDb, client } = await acquireRequestDb(radioId);
    try {
      return await runWithRequestDb(reqDb, async () => {
        const [overview, geo, sessions] = await Promise.all([
          fetchOverview(radioId),
          fetchGeo(radioId),
          includeSessions ? fetchSessions(radioId, 200) : Promise.resolve(null),
        ]);
        return JSON.stringify({ overview, geo, sessions, ts: Date.now() });
      });
    } finally {
      await releaseRequestDb(client);
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = async () => {
        if (closed) return;
        try {
          const payload = await snapshot();
          if (closed) return;
          controller.enqueue(enc.encode(`data: ${payload}\n\n`));
        } catch {
          /* best-effort : le prochain tick réessaiera */
        }
      };
      // État initial dès l'ouverture (pas d'attente du 1er tick).
      await push();
      // Tick périodique : repli universel + vieillissement des sessions.
      const tick = setInterval(push, 2000);
      // Heartbeat proxy (Railway/nginx) : maintient la connexion ouverte.
      const hb = setInterval(() => {
        if (!closed) {
          try { controller.enqueue(enc.encode(`: ping\n\n`)); } catch { /* noop */ }
        }
      }, 15000);
      timers.push(tick, hb);
      // Push quasi-instantané à la réception d'un beacon (même instance).
      offBeacon = onAnalyticsBeacon(radioId, () => { void push(); });

      // Nettoyage sur déconnexion. Le chemin GARANTI est `cancel()` ci-dessous
      // (@hono/node-server l'appelle quand le client se déconnecte). En complément,
      // SI l'adaptateur expose un `c.req.raw` de type IncomingMessage node (`.on`),
      // on s'abonne aussi à "close" ; sous node-server, `c.req.raw` est un `Request`
      // web sans `.on` → l'abonnement est un no-op inoffensif (pas de fuite, cancel
      // s'en charge).
      const rawReq = c.req.raw as unknown as { on?: (e: "close", fn: () => void) => void };
      rawReq.on?.("close", () => {
        teardown();
        try { controller.close(); } catch { /* déjà fermé */ }
      });
    },
    cancel() {
      teardown();
    },
  });

  return c.body(stream, 200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
});

/** Borne basse (incluse) de la fenêtre en jours, en DATE locale de la radio :
 *  `days = 1` → aujourd'hui seulement. Fragment SQL réutilisé par les agrégats
 *  fenêtrés (summary, breakdown, top-tracks) → même définition partout. */
function windowStart(days: number) {
  return sql`((now() AT TIME ZONE ${RADIO_TZ}::text)::date - (${days - 1} || ' days')::interval)::date`;
}

function windowDays(c: { req: { query: (k: string) => string | undefined } }): number {
  return Math.min(365, Math.max(1, Number(c.req.query("days")) || 30));
}

/* GET /v1/admin/analytics/summary?days=30 — chiffres clés FENÊTRÉS (radio
   courante). Source : analytics_daily (chaque beacon crédite le jour où il
   arrive) → le sélecteur de période de la page s'applique vraiment, alors que
   /overview reste le cumul depuis le lancement (+ temps réel). NB : les jours
   antérieurs à la migration 0027 proviennent d'une reprise d'historique
   approximative (tout le cumul d'un visiteur posé sur son premier jour). */
analyticsAdminRoutes.get("/summary", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const days = windowDays(c);
  const res = await db.execute(sql`
    SELECT count(DISTINCT client_id)::int AS "visitors",
           coalesce(sum(listen_sec), 0)::int AS "listenSec",
           coalesce(sum(active_sec), 0)::int AS "activeSec",
           coalesce(sum(page_views), 0)::int AS "pageViews"
    FROM analytics_daily
    WHERE radio_id = ${radioId}
      AND day >= ${windowStart(days)}
  `);
  const row = res.rows[0] as
    | { visitors: number; listenSec: number; activeSec: number; pageViews: number }
    | undefined;
  const visitors = Number(row?.visitors ?? 0);
  const listenSec = Number(row?.listenSec ?? 0);
  const activeSec = Number(row?.activeSec ?? 0);
  return c.json({
    days,
    visitors,
    listenSec,
    activeSec,
    pageViews: Number(row?.pageViews ?? 0),
    avgListenSec: visitors ? Math.round(listenSec / visitors) : 0,
    avgActiveSec: visitors ? Math.round(activeSec / visitors) : 0,
  });
});

/* GET /v1/admin/analytics/shows — temps d'écoute par émission (radio courante). */
analyticsAdminRoutes.get("/shows", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const rows = await db
    .select({
      showTitle: analyticsShowListen.showTitle,
      totalListenSec: sql<number>`coalesce(sum(${analyticsShowListen.listenSec}),0)::int`,
      listeners: sql<number>`count(distinct ${analyticsShowListen.clientId})::int`,
    })
    .from(analyticsShowListen)
    .where(eq(analyticsShowListen.radioId, radioId))
    .groupBy(analyticsShowListen.showTitle)
    .orderBy(sql`sum(${analyticsShowListen.listenSec}) desc`);

  return c.json(
    rows.map((r) => ({
      showTitle: r.showTitle,
      totalListenSec: r.totalListenSec,
      listeners: r.listeners,
      avgListenSec: r.listeners ? Math.round(r.totalListenSec / r.listeners) : 0,
    })),
  );
});

/* Le nettoyage des métadonnées (entités, suffixes vidéo, jingles) vit dans
   services/track-labels.ts — partagé avec le rapport mensuel et l'export CSV
   pour que console, courriel client et CSV racontent la même chose. */

/* GET /v1/admin/analytics/top-tracks?days=30 — feedback de programmation :
   titres les plus diffusés et aimés sur la fenêtre. Croise track_history
   (passages) + track_likes (🤘) + analytics_track_listen (écoute RÉELLE par
   titre, attribuée à l'ingestion — cf. services/analytics.ts). `listenSec` et
   `listeners` sont null tant que la collecte (démarrée avec la migration 0031)
   n'a rien enregistré pour le titre : on affiche « — », jamais un faux chiffre.
   Les jingles/liners de la station (« EN DIRECT ! », « LINK 1 », URLs…) sont
   exclus par filtre conservateur. Radio courante, fenêtre `days` (1..365). */
/** Requête top titres (passages + likes + écoute réelle, jingles exclus).
 *  Passages et écoute partagent la MÊME fenêtre : les `days` derniers jours
 *  CALENDAIRES locaux (comme le graphe quotidien) — pas un « now() − 30 j »
 *  glissant qui décalerait les deux compteurs de quelques heures.
 *  Exportée pour que tests/analytics-top-tracks.test.ts exécute le SQL RÉEL
 *  sur un Postgres embarqué. */
export function topTracksQuery(radioId: string, days: number) {
  return sql`
    WITH windowed AS (
      SELECT id, artist, title
      FROM track_history
      WHERE radio_id = ${radioId}
        AND played_at >= (${windowStart(days)}::timestamp AT TIME ZONE ${RADIO_TZ}::text)
    ),
    plays AS (
      SELECT (array_agg(w.id ORDER BY w.id))[1] AS "trackId",
             w.artist AS "artist",
             w.title AS "title",
             count(DISTINCT w.id)::int AS "playCount",
             count(tl.id)::int AS "likeCount"
      FROM windowed w
      LEFT JOIN track_likes tl
        ON tl.track_id = w.id AND tl.radio_id = ${radioId}
      GROUP BY w.artist, w.title
    ),
    listen AS (
      SELECT artist, title,
             sum(listen_sec)::int AS "listenSec",
             count(DISTINCT client_id)::int AS "listeners"
      FROM analytics_track_listen
      WHERE radio_id = ${radioId}
        AND day >= ${windowStart(days)}
      GROUP BY artist, title
    )
    SELECT p."trackId", p.artist, p.title, p."playCount", p."likeCount",
           l."listenSec", l."listeners"
    FROM plays p
    LEFT JOIN listen l ON l.artist = p.artist AND l.title = p.title
    WHERE NOT (
         p.title ~* ${TRACK_FILTER_RES.liner}
      OR p.title ~* ${TRACK_FILTER_RES.link}
      OR (p.title ~* '24/7' AND p.title ~* ${TRACK_FILTER_RES.radioWord})
      OR p.title ~* ${TRACK_FILTER_RES.domain}
      OR p.artist ~* ${TRACK_FILTER_RES.domain}
    )
    ORDER BY p."playCount" DESC, p."likeCount" DESC, p.title
    LIMIT 300
  `;
}

analyticsAdminRoutes.get("/top-tracks", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const days = windowDays(c);
  const tracksRes = await db.execute(topTracksQuery(radioId, days));
  return c.json(mergeTopTracks(tracksRes.rows as unknown as TopTrackRow[]));
});

/* GET /v1/admin/analytics/timeseries?days=30 — série quotidienne (radio courante).
   Source : analytics_daily, alimentée beacon par beacon. `sessions` = visiteurs
   ACTIFS ce jour-là (et non « arrivés ce jour-là » comme avant : la série était
   construite sur analytics_sessions, un cumul de vie groupé par first_seen, ce
   qui reversait toute l'écoute d'un habitué sur le jour de sa première visite).
   Les jours antérieurs à la migration 0027 restent alimentés par la reprise
   d'historique, approximative par construction. */
analyticsAdminRoutes.get("/timeseries", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const days = Math.min(180, Math.max(1, Number(c.req.query("days")) || 30));
  const result = await db.execute(sql`
    SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
           count(a.id)::int AS sessions,
           coalesce(sum(a.listen_sec), 0)::int AS listen_sec,
           coalesce(sum(a.active_sec), 0)::int AS active_sec,
           coalesce(sum(a.page_views), 0)::int AS page_views
    FROM generate_series(
           (now() AT TIME ZONE ${RADIO_TZ}::text)::date - (${days - 1} || ' days')::interval,
           (now() AT TIME ZONE ${RADIO_TZ}::text)::date,
           interval '1 day'
         ) d
    LEFT JOIN analytics_daily a
           ON a.day = d::date
          AND a.radio_id = ${radioId}
    GROUP BY d
    ORDER BY d
  `);
  return c.json(result.rows);
});

/* GET /v1/admin/analytics/geo — points agrégés par ville (radio courante).
   N'expose PAS l'IP → accessible à tout admin authentifié. */
analyticsAdminRoutes.get("/geo", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  return c.json(await fetchGeo(radioId));
});

/** Construit les points géo agrégés par ville d'une radio. Partagé entre GET /geo
 *  et le stream SSE. `live_sessions` = nombre EXACT de sessions en direct
 *  (last_seen < 60 s) dans le bucket, calculé côté serveur → cohérent avec le
 *  compteur « En direct » de /overview (même prédicat SQL). La légende de la carte
 *  somme ce champ, pas `sessions` (qui totalise toutes les sessions historiques). */
async function fetchGeo(radioId: string) {
  const result = await db.execute(sql`
    SELECT ip_lat AS lat,
           ip_lon AS lon,
           ip_country AS label,
           count(*)::int AS sessions,
           count(*) filter (where last_seen > now() - interval '60 seconds')::int AS live_sessions,
           bool_or(last_seen > now() - interval '60 seconds') AS live,
           max(last_seen) AS last_seen
    FROM analytics_sessions
    WHERE radio_id = ${radioId} AND ip_lat IS NOT NULL AND ip_lon IS NOT NULL
    GROUP BY ip_lat, ip_lon, ip_country
    ORDER BY sessions DESC
    LIMIT 500
  `);
  return result.rows;
}

/* GET /v1/admin/analytics/breakdown?days=30 — répartitions FENÊTRÉES (radio
   courante). Population : les visiteurs ACTIFS sur la période (une ligne
   analytics_daily dans la fenêtre), leurs attributs (appareil, navigateur,
   ville) étant lus sur analytics_sessions (dernier user-agent connu).
   « De retour » = vu sur ≥ 2 JOURS DISTINCTS de la période — définition exacte
   et affichable, contrairement à l'ancien proxy last_seen−first_seen (tous
   temps). `hourly` = temps d'écoute/actif par heure locale (analytics_hourly,
   exact beacon par beacon depuis la migration 0031 — vide avant). */
analyticsAdminRoutes.get("/breakdown", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const days = windowDays(c);
  const start = windowStart(days);
  const activeClients = sql`
    EXISTS (
      SELECT 1 FROM analytics_daily d
      WHERE d.radio_id = ${radioId} AND d.client_id = s.client_id AND d.day >= ${start}
    )`;
  const [devices, browsers, cities, retention, hourly] = await Promise.all([
    db.execute(sql`SELECT coalesce(s.device, '?') AS device, count(*)::int AS sessions
                   FROM analytics_sessions s WHERE s.radio_id = ${radioId} AND ${activeClients}
                   GROUP BY s.device ORDER BY sessions DESC`),
    db.execute(sql`SELECT coalesce(s.browser, '?') AS browser, count(*)::int AS sessions
                   FROM analytics_sessions s WHERE s.radio_id = ${radioId} AND ${activeClients}
                   GROUP BY s.browser ORDER BY sessions DESC`),
    db.execute(sql`SELECT s.ip_country AS label, count(*)::int AS sessions
                   FROM analytics_sessions s
                   WHERE s.radio_id = ${radioId} AND s.ip_country IS NOT NULL AND ${activeClients}
                   GROUP BY s.ip_country ORDER BY sessions DESC LIMIT 10`),
    db.execute(sql`SELECT
                     count(*) FILTER (WHERE day_count > 1)::int AS returning,
                     count(*) FILTER (WHERE day_count = 1)::int AS fresh
                   FROM (
                     SELECT client_id, count(DISTINCT day) AS day_count
                     FROM analytics_daily
                     WHERE radio_id = ${radioId} AND day >= ${start}
                     GROUP BY client_id
                   ) t`),
    db.execute(sql`SELECT hour,
                          coalesce(sum(listen_sec), 0)::int AS listen_sec,
                          coalesce(sum(active_sec), 0)::int AS active_sec
                   FROM analytics_hourly
                   WHERE radio_id = ${radioId} AND day >= ${start}
                   GROUP BY hour ORDER BY hour`),
  ]);
  return c.json({
    days,
    devices: devices.rows,
    browsers: browsers.rows,
    topCities: cities.rows,
    newVsReturning: retention.rows[0] ?? { returning: 0, fresh: 0 },
    hourly: hourly.rows,
  });
});

/* GET /v1/admin/analytics/sessions — détail des visiteurs (IP…). Éditorial :
   superadmin + owner. `it` EXCLU (les sessions exposent des IP). */
analyticsAdminRoutes.get("/sessions", requireRole("superadmin", "owner"), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const limit = Math.min(500, Math.max(1, Number(c.req.query("limit")) || 200));
  return c.json(await fetchSessions(radioId, limit));
});

/** Détail des sessions visiteurs (IP…). Réservé superadmin + owner : le stream
 *  SSE n'inclut ce champ QUE pour ces rôles (même garde que GET /sessions). */
async function fetchSessions(radioId: string, limit = 200) {
  const rows = await db
    .select()
    .from(analyticsSessions)
    .where(eq(analyticsSessions.radioId, radioId))
    .orderBy(desc(analyticsSessions.lastSeen))
    .limit(limit);
  return rows;
}

/* GET /v1/admin/analytics/export?type=sessions|shows|tracks — CSV. Éditorial :
   superadmin + owner. `it` EXCLU (le CSV sessions expose les IP ; même garde
   pour tous les types — une seule règle simple). `tracks` accepte `days`
   (fenêtre du top titres, mêmes nettoyage/filtre/fusion que la page). */
analyticsAdminRoutes.get("/export", requireRole("superadmin", "owner"), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const rawType = c.req.query("type");
  const type = rawType === "shows" || rawType === "tracks" ? rawType : "sessions";
  let csv: string;
  let filename: string;

  if (type === "tracks") {
    const days = windowDays(c);
    const res = await db.execute(topTracksQuery(radioId, days));
    const rows = mergeTopTracks(res.rows as unknown as TopTrackRow[]);
    csv = toCsv(
      ["Titre", "Artiste", "Passages", "Likes", "Ecoute_sec", "Auditeurs"],
      rows.map((t) => [t.title, t.artist, t.playCount, t.likeCount, t.listenSec ?? "", t.listeners ?? ""]),
    );
    filename = `top-titres-${days}j.csv`;
  } else if (type === "shows") {
    const rows = await db
      .select({
        showTitle: analyticsShowListen.showTitle,
        totalListenSec: sql<number>`coalesce(sum(${analyticsShowListen.listenSec}),0)::int`,
        listeners: sql<number>`count(distinct ${analyticsShowListen.clientId})::int`,
      })
      .from(analyticsShowListen)
      .where(eq(analyticsShowListen.radioId, radioId))
      .groupBy(analyticsShowListen.showTitle)
      .orderBy(sql`sum(${analyticsShowListen.listenSec}) desc`);
    csv = toCsv(
      ["Emission", "Ecoute_totale_sec", "Auditeurs", "Moyenne_sec"],
      rows.map((r) => [
        r.showTitle,
        r.totalListenSec,
        r.listeners,
        r.listeners ? Math.round(r.totalListenSec / r.listeners) : 0,
      ]),
    );
    filename = "ecoute-par-emission.csv";
  } else {
    const rows = await db
      .select()
      .from(analyticsSessions)
      .where(eq(analyticsSessions.radioId, radioId))
      .orderBy(desc(analyticsSessions.lastSeen));
    csv = toCsv(
      ["client_id", "ip", "pays", "navigateur", "appareil", "premier_vu", "dernier_vu", "actif_sec", "ecoute_sec", "pages"],
      rows.map((r) => [
        r.clientId,
        r.ip,
        r.ipCountry,
        r.browser,
        r.device,
        r.firstSeen?.toISOString(),
        r.lastSeen?.toISOString(),
        r.activeSec,
        r.listenSec,
        r.pageViews,
      ]),
    );
    filename = "sessions.csv";
  }

  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.body(csv);
});
