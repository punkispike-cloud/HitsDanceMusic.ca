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
  const [agg] = await db
    .select({
      totalSessions: sql<number>`count(*)::int`,
      live: sql<number>`count(*) filter (where ${analyticsSessions.lastSeen} > now() - interval '60 seconds')::int`,
      today: sql<number>`count(*) filter (where ${analyticsSessions.lastSeen} >= date_trunc('day', now()))::int`,
      sumActive: sql<number>`coalesce(sum(${analyticsSessions.activeSec}),0)::int`,
      sumListen: sql<number>`coalesce(sum(${analyticsSessions.listenSec}),0)::int`,
      pageViews: sql<number>`coalesce(sum(${analyticsSessions.pageViews}),0)::int`,
    })
    .from(analyticsSessions)
    .where(eq(analyticsSessions.radioId, radioId));

  const total = agg?.totalSessions ?? 0;
  return c.json({
    totalSessions: total,
    live: agg?.live ?? 0,
    today: agg?.today ?? 0,
    pageViews: agg?.pageViews ?? 0,
    totalActiveSec: agg?.sumActive ?? 0,
    totalListenSec: agg?.sumListen ?? 0,
    avgActiveSec: total ? Math.round((agg!.sumActive ?? 0) / total) : 0,
    avgListenSec: total ? Math.round((agg!.sumListen ?? 0) / total) : 0,
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
  const result = await db.execute(sql`
    SELECT ip_lat AS lat,
           ip_lon AS lon,
           ip_country AS label,
           count(*)::int AS sessions,
           bool_or(last_seen > now() - interval '60 seconds') AS live,
           max(last_seen) AS last_seen
    FROM analytics_sessions
    WHERE radio_id = ${radioId} AND ip_lat IS NOT NULL AND ip_lon IS NOT NULL
    GROUP BY ip_lat, ip_lon, ip_country
    ORDER BY sessions DESC
    LIMIT 500
  `);
  return c.json(result.rows);
});

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
  const rows = await db
    .select()
    .from(analyticsSessions)
    .where(eq(analyticsSessions.radioId, radioId))
    .orderBy(desc(analyticsSessions.lastSeen))
    .limit(limit);
  return c.json(rows);
});

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
