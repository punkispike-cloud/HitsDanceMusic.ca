/* Health check (calque presence /health).

   Expose aussi l'ARMEMENT de l'observabilité. `monitor: true` + `alerts: false`
   est la signature exacte de l'angle mort trouvé le 2026-08-21 : le moniteur
   détecte down/silent et écrit radios.health_status, mais `monitor.ts` n'envoie
   d'alerte QUE si Resend est configuré — sans canal, la détection se termine
   dans le vide et une panne d'antenne reste invisible.

   Ces trois champs sont des BOOLÉENS d'état, jamais des valeurs : ils ne
   révèlent aucun DSN, aucune clé, aucun domaine. Le gain pour un attaquant est
   marginal (il ne peut rien en faire), alors que le gain ops est direct :
   scripts/verify-deploy.mjs et scripts/pre-go-live.mjs (check #9) les lisent
   sans authentification, et une sonde externe peut alerter dessus. */

import { Hono } from "hono";
import { pingDb } from "../db/client.js";
import { isMonitorEnabled, isResendConfigured, isSentryConfigured } from "../env.js";

export const healthRoutes = new Hono();

healthRoutes.get("/health", async (c) => {
  const dbOk = await pingDb();
  return c.json(
    {
      ok: dbOk,
      db: dbOk,
      service: "hitradio-api",
      /** Surveillance des flux en arrière-plan (MONITOR_ENABLED, défaut true). */
      monitor: isMonitorEnabled(),
      /** Canal d'alerte disponible (Resend). false ⇒ aucune alerte ne sortira. */
      alerts: isResendConfigured(),
      /** Capture des exceptions (Sentry). */
      sentry: isSentryConfigured(),
    },
    dbOk ? 200 : 503,
  );
});
