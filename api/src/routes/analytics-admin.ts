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
