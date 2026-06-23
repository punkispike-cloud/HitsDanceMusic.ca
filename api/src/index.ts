/* Point d'entrée de l'API Hits Dance Music.
   Monte les routes, applique CORS / rate-limit / body-limit, gère l'arrêt
   gracieux (calque presence/server.js:201-211). */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { bodyLimit } from "hono/body-limit";
import { env } from "./env.js";
import { corsMiddleware } from "./middleware/cors.js";
import { onError, notFoundHandler } from "./middleware/error.js";
import { globalRateLimit, authRateLimit } from "./middleware/rateLimit.js";
import { requireAuth } from "./middleware/auth.js";
import { publicTenant, adminTenant } from "./middleware/tenant.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { publicRoutes } from "./routes/public.js";
import { adminRoutes } from "./routes/admin.js";
import { uploadRoutes } from "./routes/uploads.js";
import { trackRoutes } from "./routes/track.js";
import { analyticsAdminRoutes } from "./routes/analytics-admin.js";
import { rssRoutes } from "./routes/rss.js";
import { shareRoutes } from "./routes/share.js";
import { pushRoutes } from "./routes/push.js";
import { pushAdminRoutes } from "./routes/push-admin.js";
import { auditAdminRoutes } from "./routes/audit-admin.js";
import { nowPlayingRoutes } from "./routes/now-playing.js";
import { ownerRoutes } from "./routes/owner.js";
import { auditMiddleware } from "./middleware/audit.js";
import { pingDb, closeDb } from "./db/client.js";
import { startMaintenance } from "./services/maintenance.js";
import { initMonitoring } from "./services/monitoring.js";
import { initPush } from "./services/push.js";
import { startReminders } from "./services/reminders.js";
import { startTrackHistory } from "./services/track-history.js";
import type { AppBindings } from "./types.js";

// Monitoring d'abord (capture les erreurs dès le boot, si SENTRY_DSN présent).
initMonitoring();

const app = new Hono<AppBindings>();

app.onError(onError);
app.notFound(notFoundHandler);

// Sécurité transverse
app.use("*", corsMiddleware);
app.use("*", bodyLimit({ maxSize: env.MAX_BODY_BYTES, onError: (c) => c.json({ error: { code: "payload_too_large", message: "Corps de requête trop volumineux" } }, 413) }));
app.use("*", globalRateLimit(env.RATE_LIMIT_RPM));

// Health (racine)
app.route("/", healthRoutes);

// Auth — rate-limit strict anti-bruteforce
app.use("/auth/*", authRateLimit(env.AUTH_RATE_LIMIT_RPM));
app.route("/auth", authRoutes);

// Lecture publique + ingestion analytics (beacons anonymes)
// Résout la radio depuis l'hôte HTTP (mono-radio → l'unique radio).
app.use("/v1/*", publicTenant);
app.route("/v1", publicRoutes);
app.route("/v1", trackRoutes);
app.route("/v1", rssRoutes); // GET /v1/rss/:showSlug
app.route("/v1", shareRoutes); // GET /v1/share/...
app.route("/v1", pushRoutes); // abonnement Web Push (public)

// Admin — auth obligatoire + résolution de la radio + journal d'audit
app.use("/v1/admin/*", requireAuth);
app.use("/v1/admin/*", adminTenant);
app.use("/v1/admin/*", auditMiddleware);
app.route("/v1/admin", adminRoutes);
app.route("/v1/admin/uploads", uploadRoutes);
app.route("/v1/admin/analytics", analyticsAdminRoutes);
app.route("/v1/admin/audit", auditAdminRoutes);
app.route("/v1/admin/push", pushAdminRoutes);
app.route("/v1/admin/tracks", nowPlayingRoutes);

// Console opérateur (owner En Ondes) — cross-radio, sans scoping single-radio.
app.use("/v1/owner/*", requireAuth);
app.route("/v1/owner", ownerRoutes);

// Démarrage
const server = serve({ fetch: app.fetch, port: env.PORT }, async (info) => {
  const ok = await pingDb();
  console.log(`[api] écoute sur :${info.port} (env=${env.NODE_ENV})`);
  console.log(`[api] origines autorisées : ${env.ALLOWED_ORIGINS.join(", ")}`);
  console.log(`[api] DB : ${ok ? "connectée ✓" : "INJOIGNABLE ✗"}`);
  startMaintenance();
  initPush();
  startReminders();
  startTrackHistory();
});

// Arrêt gracieux
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[api] ${sig} reçu, fermeture…`);
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
