/* Entretien périodique de la base : purge des données éphémères pour éviter
   une croissance illimitée des tables. Lancé au démarrage puis une fois/jour. */

import { lt, and, eq, isNotNull, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { refreshTokens, uploadIntents, analyticsSessions, analyticsShowListen, analyticsDaily, auditLog, rateBuckets, songRequests } from "../db/schema.js";
import { env } from "../env.js";
import { deleteObject, isS3Configured } from "../lib/s3.js";
import { withAdvisoryLock } from "./lock.js";
import { bindRequestDb } from "../db/tenant-guc.js";

const DAY = 24 * 60 * 60 * 1000;
const AUDIT_RETENTION_DAYS = 365; // on garde l'audit plus longtemps que l'analytics

export async function runCleanup(): Promise<void> {
  // GUC vide explicite (cross-radio) — cohérent si DATABASE_URL = enondes_app.
  await bindRequestDb(null, () => runCleanupInner());
}

async function runCleanupInner(): Promise<void> {
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
    // Les intents 'pending' (jamais confirmés) laissent un objet S3 orphelin :
    // on le supprime AUSSI (best-effort) avant de purger la ligne, sinon fuite de
    // stockage. Les intents 'completed' pointent un objet rattaché (mix/épisode)
    // → on ne supprime QUE la ligne, jamais l'objet.
    const intentCutoff = new Date(now - DAY);
    let orphanObjects = 0;
    if (isS3Configured()) {
      const orphans = await db
        .select({ objectKey: uploadIntents.objectKey })
        .from(uploadIntents)
        .where(and(eq(uploadIntents.status, "pending"), lt(uploadIntents.createdAt, intentCutoff)));
      await Promise.all(
        orphans.map((o) =>
          deleteObject(o.objectKey).catch((e) => {
            console.warn(`[cleanup] suppression S3 orpheline échouée (${o.objectKey})`, e);
          }),
        ),
      );
      orphanObjects = orphans.length;
    }
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
    // Ventilation quotidienne : même fenêtre (elle porte un client_id).
    const delDaily = await db
      .delete(analyticsDaily)
      .where(lt(analyticsDaily.day, analyticsCutoff.toISOString().slice(0, 10)))
      .returning({ id: analyticsDaily.id });

    // Demandes de titres / dédicaces : dedication + requester_name sont des données
    // potentiellement personnelles → purge alignée sur la même fenêtre (Loi 25).
    const delRequests = await db
      .delete(songRequests)
      .where(lt(songRequests.createdAt, analyticsCutoff))
      .returning({ id: songRequests.id });

    // Journal d'audit : conservé 1 an.
    const auditCutoff = new Date(now - AUDIT_RETENTION_DAYS * DAY);
    const delAudit = await db
      .delete(auditLog)
      .where(lt(auditLog.createdAt, auditCutoff))
      .returning({ id: auditLog.id });

    // Rate-limit auth DB (C1.3) : purge des buckets de fenêtre expirés.
    const delBuckets = await db
      .delete(rateBuckets)
      .where(lt(rateBuckets.expiresAt, new Date()))
      .returning({ key: rateBuckets.key });

    console.log(
      `[cleanup] refresh_tokens: ${delTokens.length}, upload_intents: ${delIntents.length} (objets S3 orphelins: ${orphanObjects}), ` +
        `analytics_sessions: ${delSessions.length}, show_listen: ${delListen.length}, analytics_daily: ${delDaily.length}, song_requests: ${delRequests.length}, audit_log: ${delAudit.length}, rate_buckets: ${delBuckets.length}`,
    );
  } catch (err) {
    console.error("[cleanup] échec (non bloquant)", err);
  }
}

/** Démarre la purge : une fois au boot (différée) puis toutes les 24 h.
    Le tick est wrappé par un verrou advisory (C1.2) : en multi-instance, une
    seule instance exécute la purge à la fois. */
export function startMaintenance(): void {
  const run = () => withAdvisoryLock("job:maintenance", runCleanup);
  setTimeout(() => void run(), 30_000).unref();
  setInterval(() => void run(), DAY).unref();
}
