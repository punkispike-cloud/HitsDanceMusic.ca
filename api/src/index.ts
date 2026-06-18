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
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { publicRoutes } from "./routes/public.js";
import { adminRoutes } from "./routes/admin.js";
import { uploadRoutes } from "./routes/uploads.js";
import { pingDb, closeDb } from "./db/client.js";
import type { AppBindings } from "./types.js";

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

// Lecture publique
app.route("/v1", publicRoutes);

// Admin — auth obligatoire sur tout /v1/admin
app.use("/v1/admin/*", requireAuth);
app.route("/v1/admin", adminRoutes);
app.route("/v1/admin/uploads", uploadRoutes);

// Démarrage
const server = serve({ fetch: app.fetch, port: env.PORT }, async (info) => {
  const ok = await pingDb();
  console.log(`[api] écoute sur :${info.port} (env=${env.NODE_ENV})`);
  console.log(`[api] origines autorisées : ${env.ALLOWED_ORIGINS.join(", ")}`);
  console.log(`[api] DB : ${ok ? "connectée ✓" : "INJOIGNABLE ✗"}`);
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
