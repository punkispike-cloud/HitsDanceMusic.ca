/* Lecture des statistiques d'audience (console admin). Monté sous /v1/admin →
   déjà protégé par requireAuth + adminTenant. Tout est filtré par radio :
   chaque radio ne voit QUE son audience. La liste des sessions expose les IP
   (donnée personnelle) → réservée au superadmin. */

import { Hono } from "hono";
import { sql, eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { analyticsSessions, analyticsShowListen } from "../db/schema.js";
import { requireRole } from "../middleware/rbac.js";
import { requireRadioId } from "../services/tenant.js";
import { onAnalyticsBeacon } from "../services/analytics-bus.js";
import type { AppBindings } from "../types.js";

/* Un « skip » = écoute courte : seuil de 15 s sur analytics_show_listen.
   Le seuil est volontairement bas (un auditeur qui reste < 15 s a zappé). */
const SKIP_THRESHOLD_SEC = 15;

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
      // « aujourd'hui » au fuseau de la radio (America/Toronto), cohérent avec
      // /timeseries qui génère ses jours dans ce même fuseau. `date_trunc('day',
      // now())` utiliserait le fuseau de session (UTC) → minuit UTC = 19 h/20 h
      // la veille à Toronto, faussant le compteur en début/fin de journée.
      today: sql<number>`count(*) filter (where (last_seen AT TIME ZONE 'America/Toronto')::date = (now() AT TIME ZONE 'America/Toronto')::date)::int`,
      sumActive: sql<number>`coalesce(sum(${analyticsSessions.activeSec}),0)::int`,
      sumListen: sql<number>`coalesce(sum(${analyticsSessions.listenSec}),0)::int`,
      pageViews: sql<number>`coalesce(sum(${analyticsSessions.pageViews}),0)::int`,
    })
    .from(analyticsSessions)
    .where(eq(analyticsSessions.radioId, radioId));

  const total = agg?.totalSessions ?? 0;
  return {
    totalSessions: total,
    live: agg?.live ?? 0,
    today: agg?.today ?? 0,
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
    const [overview, geo, sessions] = await Promise.all([
      fetchOverview(radioId),
      fetchGeo(radioId),
      includeSessions ? fetchSessions(radioId, 200) : Promise.resolve(null),
    ]);
    return JSON.stringify({ overview, geo, sessions, ts: Date.now() });
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

/* GET /v1/admin/analytics/top-tracks?days=30 — feedback de programmation :
   titres les plus diffusés et aimés sur la fenêtre, + écoute moyenne et taux de
   skip (écoute courte). Croise track_history (passages) + track_likes (🤘) +
   analytics_show_listen (écoute/skip). ⚠️ analytics_show_listen est agrégé par
   émission, pas par titre — il n'existe pas en base de liaison titre↔écoute, donc
   avgListenSec et skipRate sont des contextes au niveau radio (identiques sur
   chaque ligne) : ils décrivent le comportement d'écoute global pendant la fenêtre,
   à lire alongside playCount/likeCount qui, eux, sont par titre. Radio courante,
   fenêtre `days` (1..365, défaut 30). */
analyticsAdminRoutes.get("/top-tracks", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const days = Math.min(365, Math.max(1, Number(c.req.query("days")) || 30));

  const [tracksRes, listenRes] = await Promise.all([
    db.execute(sql`
      WITH windowed AS (
        SELECT id, artist, title
        FROM track_history
        WHERE radio_id = ${radioId}
          AND played_at >= now() - (${days} || ' days')::interval
      )
      SELECT min(w.id) AS "trackId",
             w.artist AS "artist",
             w.title AS "title",
             count(DISTINCT w.id)::int AS "playCount",
             count(tl.id)::int AS "likeCount"
      FROM windowed w
      LEFT JOIN track_likes tl
        ON tl.track_id = w.id AND tl.radio_id = ${radioId}
      GROUP BY w.artist, w.title
      ORDER BY "playCount" DESC, "likeCount" DESC, w.title
      LIMIT 100
    `),
    db.execute(sql`
      SELECT coalesce(avg(listen_sec), 0)::float AS "avgListenSec",
             count(*)::int AS "totalListen",
             count(*) FILTER (WHERE listen_sec < ${SKIP_THRESHOLD_SEC})::int AS "shortListen"
      FROM analytics_show_listen
      WHERE radio_id = ${radioId}
        AND last_at >= now() - (${days} || ' days')::interval
    `),
  ]);

  type TopTrackRow = {
    trackId: string;
    artist: string;
    title: string;
    playCount: number;
    likeCount: number;
  };
  const rows = tracksRes.rows as TopTrackRow[];

  const listen = listenRes.rows[0] as
    | { avgListenSec: number; totalListen: number; shortListen: number }
    | undefined;
  const total = listen?.totalListen ?? 0;
  const short = listen?.shortListen ?? 0;
  const avgListenSec = listen ? Math.round(Number(listen.avgListenSec) || 0) : 0;
  const skipRate = total ? Math.round((short / total) * 100) : 0; // %

  return c.json(
    rows.map((r) => ({
      trackId: r.trackId,
      artist: r.artist,
      title: r.title,
      playCount: r.playCount,
      likeCount: r.likeCount,
      avgListenSec,
      skipRate,
    })),
  );
});

/* GET /v1/admin/analytics/timeseries?days=30 — série quotidienne (radio courante). */
analyticsAdminRoutes.get("/timeseries", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const days = Math.min(180, Math.max(1, Number(c.req.query("days")) || 30));
  const result = await db.execute(sql`
    SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
           count(s.id)::int AS sessions,
           coalesce(sum(s.listen_sec), 0)::int AS listen_sec,
           coalesce(sum(s.active_sec), 0)::int AS active_sec,
           coalesce(sum(s.page_views), 0)::int AS page_views
    FROM generate_series(
           (now() AT TIME ZONE 'America/Toronto')::date - (${days - 1} || ' days')::interval,
           (now() AT TIME ZONE 'America/Toronto')::date,
           interval '1 day'
         ) d
    LEFT JOIN analytics_sessions s
           ON date_trunc('day', s.first_seen AT TIME ZONE 'America/Toronto') = d
          AND s.radio_id = ${radioId}
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

/* GET /v1/admin/analytics/breakdown — répartitions (radio courante). */
analyticsAdminRoutes.get("/breakdown", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const [devices, browsers, cities, retention, hourly] = await Promise.all([
    db.execute(sql`SELECT coalesce(device, '?') AS device, count(*)::int AS sessions
                   FROM analytics_sessions WHERE radio_id = ${radioId} GROUP BY device ORDER BY sessions DESC`),
    db.execute(sql`SELECT coalesce(browser, '?') AS browser, count(*)::int AS sessions
                   FROM analytics_sessions WHERE radio_id = ${radioId} GROUP BY browser ORDER BY sessions DESC`),
    db.execute(sql`SELECT ip_country AS label, count(*)::int AS sessions
                   FROM analytics_sessions WHERE radio_id = ${radioId} AND ip_country IS NOT NULL
                   GROUP BY ip_country ORDER BY sessions DESC LIMIT 10`),
    db.execute(sql`SELECT
                     count(*) FILTER (WHERE last_seen - first_seen > interval '1 day')::int AS returning,
                     count(*) FILTER (WHERE last_seen - first_seen <= interval '1 day')::int AS fresh
                   FROM analytics_sessions WHERE radio_id = ${radioId}`),
    db.execute(sql`SELECT extract(hour FROM first_seen AT TIME ZONE 'America/Toronto')::int AS hour,
                          count(*)::int AS sessions
                   FROM analytics_sessions WHERE radio_id = ${radioId} GROUP BY hour ORDER BY hour`),
  ]);
  return c.json({
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

/* GET /v1/admin/analytics/export?type=sessions|shows — CSV. Éditorial :
   superadmin + owner. `it` EXCLU (le CSV sessions expose les IP). */
analyticsAdminRoutes.get("/export", requireRole("superadmin", "owner"), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const type = c.req.query("type") === "shows" ? "shows" : "sessions";
  let csv: string;
  let filename: string;

  if (type === "shows") {
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
