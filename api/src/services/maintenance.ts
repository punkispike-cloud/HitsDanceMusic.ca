/* Entretien périodique de la base : purge des données éphémères pour éviter
   une croissance illimitée des tables. Lancé au démarrage puis une fois/jour. */

import { lt, and, isNotNull, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { refreshTokens, uploadIntents } from "../db/schema.js";

const DAY = 24 * 60 * 60 * 1000;

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

    console.log(
      `[cleanup] refresh_tokens supprimés: ${delTokens.length}, upload_intents: ${delIntents.length}`,
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
