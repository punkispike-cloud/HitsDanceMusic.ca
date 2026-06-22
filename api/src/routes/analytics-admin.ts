/* Lecture des statistiques d'audience (console admin). Monté sous /v1/admin,
   donc déjà protégé par requireAuth. La liste des sessions expose les IP
   (donnée personnelle) → réservée au superadmin. */

import { Hono } from "hono";
import { sql, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { analyticsSessions, analyticsShowListen } from "../db/schema.js";
import { requireRole } from "../middleware/rbac.js";
import type { AppBindings } from "../types.js";

export const analyticsAdminRoutes = new Hono<AppBindings>();

/** Échappe une valeur pour une cellule CSV (RFC 4180). */
function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return "﻿" + lines.join("\r\n"); // BOM → Excel ouvre l'UTF-8 correctement
}

/* GET /v1/admin/analytics/overview — chiffres clés. */
analyticsAdminRoutes.get("/overview", async (c) => {
  const [agg] = await db
    .select({
      totalSessions: sql<number>`count(*)::int`,
      live: sql<number>`count(*) filter (where ${analyticsSessions.lastSeen} > now() - interval '60 seconds')::int`,
      today: sql<number>`count(*) filter (where ${analyticsSessions.lastSeen} >= date_trunc('day', now()))::int`,
      sumActive: sql<number>`coalesce(sum(${analyticsSessions.activeSec}),0)::int`,
      sumListen: sql<number>`coalesce(sum(${analyticsSessions.listenSec}),0)::int`,
      pageViews: sql<number>`coalesce(sum(${analyticsSessions.pageViews}),0)::int`,
    })
    .from(analyticsSessions);

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

/* GET /v1/admin/analytics/shows — temps d'écoute par émission. */
analyticsAdminRoutes.get("/shows", async (c) => {
  const rows = await db
    .select({
      showTitle: analyticsShowListen.showTitle,
      totalListenSec: sql<number>`coalesce(sum(${analyticsShowListen.listenSec}),0)::int`,
      listeners: sql<number>`count(distinct ${analyticsShowListen.clientId})::int`,
    })
    .from(analyticsShowListen)
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

/* GET /v1/admin/analytics/timeseries?days=30 — série quotidienne (axe continu).
   Nouveaux visiteurs / temps d'écoute / temps actif par jour. */
analyticsAdminRoutes.get("/timeseries", async (c) => {
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
    GROUP BY d
    ORDER BY d
  `);
  return c.json(result.rows);
});

/* GET /v1/admin/analytics/geo — points agrégés par ville (lat/lon) pour la carte
   des visiteurs. N'expose PAS l'IP → accessible à tout admin authentifié. */
analyticsAdminRoutes.get("/geo", async (c) => {
  const result = await db.execute(sql`
    SELECT ip_lat AS lat,
           ip_lon AS lon,
           ip_country AS label,
           count(*)::int AS sessions,
           bool_or(${analyticsSessions.lastSeen} > now() - interval '60 seconds') AS live,
           max(${analyticsSessions.lastSeen}) AS last_seen
    FROM analytics_sessions
    WHERE ip_lat IS NOT NULL AND ip_lon IS NOT NULL
    GROUP BY ip_lat, ip_lon, ip_country
    ORDER BY sessions DESC
    LIMIT 500
  `);
  return c.json(result.rows);
});

/* GET /v1/admin/analytics/sessions — détail des visiteurs (IP, navigateur…).
   Superadmin uniquement (expose des données personnelles). */
analyticsAdminRoutes.get("/sessions", requireRole("superadmin"), async (c) => {
  const limit = Math.min(500, Math.max(1, Number(c.req.query("limit")) || 200));
  const rows = await db
    .select()
    .from(analyticsSessions)
    .orderBy(desc(analyticsSessions.lastSeen))
    .limit(limit);
  return c.json(rows);
});

/* GET /v1/admin/analytics/export?type=sessions|shows — téléchargement CSV.
   Superadmin uniquement. */
analyticsAdminRoutes.get("/export", requireRole("superadmin"), async (c) => {
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
    const rows = await db.select().from(analyticsSessions).orderBy(desc(analyticsSessions.lastSeen));
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
