/* Entretien périodique de la base : purge des données éphémères pour éviter
   une croissance illimitée des tables. Lancé au démarrage puis une fois/jour. */

import { lt, and, isNotNull, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { refreshTokens, uploadIntents, analyticsSessions, analyticsShowListen, auditLog } from "../db/schema.js";
import { env } from "../env.js";

const DAY = 24 * 60 * 60 * 1000;
const AUDIT_RETENTION_DAYS = 365; // on garde l'audit plus longtemps que l'analytics

export async function runCleanup(): Promise<void> {
  const now = Date.now();
  try {
    // Refresh tokens : supprime les expirés, et les révoqués depuis > 7 jours
    // (on garde 7 j de révoqués pour la détection de réutilisation/audit).
    const revokedCutoff = new Date(now - 7 * DAY);
    const expiredCutoff = new Date(now);
    const delTokens = await db
      .delete(refreshTokens)
      .where(
        or(
          lt(refreshTokens.expiresAt, expiredCutoff),
          and(isNotNull(refreshTokens.revokedAt), lt(refreshTokens.revokedAt, revokedCutoff)),
        ),
      )
      .returning({ id: refreshTokens.id });

    // Intents d'upload : éphémères (URL pré-signée valable 15 min). Purge > 1 j.
    const intentCutoff = new Date(now - DAY);
    const delIntents = await db
      .delete(uploadIntents)
      .where(lt(uploadIntents.createdAt, intentCutoff))
      .returning({ id: uploadIntents.id });

    // Rétention analytics (Loi 25) : purge des données personnelles (IP incluse)
    // au-delà de la fenêtre de conservation. Configurable via ANALYTICS_RETENTION_DAYS.
    const analyticsCutoff = new Date(now - env.ANALYTICS_RETENTION_DAYS * DAY);
    const delSessions = await db
      .delete(analyticsSessions)
      .where(lt(analyticsSessions.lastSeen, analyticsCutoff))
      .returning({ id: analyticsSessions.id });
    const delListen = await db
      .delete(analyticsShowListen)
      .where(lt(analyticsShowListen.lastAt, analyticsCutoff))
      .returning({ id: analyticsShowListen.id });

    // Journal d'audit : conservé 1 an.
    const auditCutoff = new Date(now - AUDIT_RETENTION_DAYS * DAY);
    const delAudit = await db
      .delete(auditLog)
      .where(lt(auditLog.createdAt, auditCutoff))
      .returning({ id: auditLog.id });

    console.log(
      `[cleanup] refresh_tokens: ${delTokens.length}, upload_intents: ${delIntents.length}, ` +
        `analytics_sessions: ${delSessions.length}, show_listen: ${delListen.length}, audit_log: ${delAudit.length}`,
    );
  } catch (err) {
    console.error("[cleanup] échec (non bloquant)", err);
  }
}

/** Démarre la purge : une fois au boot (différée) puis toutes les 24 h. */
export function startMaintenance(): void {
  setTimeout(() => void runCleanup(), 30_000).unref();
  setInterval(() => void runCleanup(), DAY).unref();
}
