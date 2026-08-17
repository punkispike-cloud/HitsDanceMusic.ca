/* Endpoints de santé/diagnostic sous /v1/admin (déjà protégés par requireAuth +
   adminTenant + auditMiddleware au montage). Inclut le test Sentry : capture une
   erreur synthétique pour valider que SENTRY_DSN est bien posé et que les
   événements remontent (runbook §1.4 — « provoquer une erreur test → événement
   visible sous 1 min »). Inoffensif : ne fait que capturer, ne casse rien. */

import { Hono } from "hono";
import { isSentryConfigured } from "../env.js";
import { captureError } from "../services/monitoring.js";
import { requireRole } from "../middleware/rbac.js";
import type { AppBindings } from "../types.js";

export const healthAdminRoutes = new Hono<AppBindings>();

/* POST /v1/admin/health/sentry-test — capture une erreur synthétique.
   Renvoie 200 { ok, sentry: true|false } : `sentry:false` = DSN absent (Sentry
   inactif, l'erreur reste en console). `sentry:true` = vérifier l'arrivée de
   l'événement dans le dashboard Sentry sous ~1 min.
   Restreint aux rôles techniques (audit 2026-08-16) : un animateur/lecteur n'a
   pas à pouvoir déclencher des captures Sentry à volonté. */
healthAdminRoutes.post("/sentry-test", requireRole("it", "superadmin", "owner"), (c) => {
  const configured = isSentryConfigured();
  captureError(new Error("sentry-test: vérification manuelle du DSN"), {
    path: c.req.path,
    method: c.req.method,
    manual: true,
  });
  return c.json({ ok: true, sentry: configured });
});
