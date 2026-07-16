/* Primitives d'isolation multi-tenant au runtime (RLS Postgres).
 *
 La migration 0022 pose les policies ; 0025 ajoute FORCE RLS + le rôle applicatif
 `enondes_app`. L'isolation ne s'active QUE si l'API pose la GUC `app.radio_id`
 par requête. Comme le pool partage les connexions, la GUC doit être posée DANS une
 transaction (SET LOCAL / set_config(..., true)) ou sur un client dédié à la requête
 (set_config(..., false) au niveau session, reset à la libération).
 *
 Deux modes d'emploi :
 *  - withTenantGuc(radioId, fn) / withCrossRadio(fn) : wrappers transactionnels —
 *    le callback reçoit un `tx` Drizzle (mêmes méthodes que `db`) à utiliser à la
 *    place de `db`. C'est le chemin d'activation : migrer les handlers tenant vers
 *    ces wrappers (le garde `tenant:guard` avec RLS_STRICT=1 signale les accès non
 *    wrappés). withCrossRadio laisse la GUC vide → tout visible (owner/it, jobs).
 *  - acquireRequestDb/releaseRequestDb : acquisition d'un client dédié + GUC session,
 *    pour un middleware par requête exposant un `db` request-scoped (c.set("db")).
 *
 NB : set_config (et non `SET LOCAL ... = $1`) accepte un paramètre bindé — `SET`
 n'accepte pas de paramètres prepared. Le 3e arg `true` = local (transaction). */

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { db, pool } from "./client.js";
import * as schema from "./schema.js";

/** Type de la transaction Drizzle passée à db.transaction (mêmes méthodes que db). */
type Tx = Parameters<typeof db.transaction>[0] extends (tx: infer T) => unknown ? T : never;

/** Pose la GUC app.radio_id (locale à la transaction) sur une transaction Drizzle. */
export async function setRadioIdGuc(tx: Tx, radioId: string | null): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.radio_id', ${radioId ?? ""}, true)`);
}

/** Exécute `fn` dans une transaction Drizzle isolée au tenant `radioId`. Le callback
 *  reçoit un `tx` à utiliser à la place du `db` global. */
export async function withTenantGuc<T>(radioId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await setRadioIdGuc(tx, radioId);
    return fn(tx);
  });
}

/** Exécute `fn` dans une transaction Drizzle en mode cross-radio (GUC vide → tout
 *  visible). Pour les routes /v1/owner/* et les jobs globaux (monitor/reports/
 *  maintenance). explicite = intentionnel (pas un oubli). */
export async function withCrossRadio<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await setRadioIdGuc(tx, null);
    return fn(tx);
  });
}

/* ─────────────── Chemin middleware (client dédié par requête) ─────────────── */

/** Acquiert un client dédié du pool, pose la GUC app.radio_id au niveau session et
 *  renvoie un `db` Drizzle lié à ce client. À libérer avec releaseRequestDb.
 *  `radioId` null = cross-radio (GUC vide). */
export async function acquireRequestDb(radioId: string | null): Promise<{ db: typeof db; client: PoolClient }> {
  const client = await pool.connect();
  await client.query("SELECT set_config('app.radio_id', $1, false)", [radioId ?? ""]);
  const reqDb = drizzle(client, { schema });
  return { db: reqDb as unknown as typeof db, client };
}

/** Réinitialise la GUC (sécurité avant remise au pool) puis libère le client. */
export async function releaseRequestDb(client: PoolClient): Promise<void> {
  try {
    await client.query("SELECT set_config('app.radio_id', '', false)");
  } catch {
    /* noop — on libère quoi qu'il arrive */
  }
  client.release();
}
