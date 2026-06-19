/* Monitoring d'erreurs (Sentry). Totalement inactif tant que SENTRY_DSN n'est
   pas fourni : on garde alors le comportement actuel (console). Une fois le DSN
   posé en variable d'env, les erreurs non gérées remontent automatiquement. */

import * as Sentry from "@sentry/node";
import { env, isSentryConfigured } from "../env.js";

let started = false;

/** À appeler au tout début du boot (avant de monter les routes). */
export function initMonitoring(): void {
  if (started || !isSentryConfigured()) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0, // pas de tracing pour l'instant (coût) — uniquement les erreurs
  });
  started = true;
  console.log("[monitoring] Sentry actif ✓");
}

/** Capture une erreur (no-op si Sentry inactif). */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!started) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
