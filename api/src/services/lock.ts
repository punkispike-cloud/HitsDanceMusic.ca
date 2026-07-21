/* Verrou distribué via advisory locks Postgres (C1.2).
   En multi-instance Railway, chaque instance démarre ses propres pollers →
   double exécution (double now-playing, double rappel, double rapport, double
   purge). `withAdvisoryLock` garantit qu'un seul tick tourne à la fois, AU-DELÀ
   des frontières de process : `pg_try_advisory_lock` est un verrou de session
   global au cluster Postgres.

   - Skip silencieux si le verrou est déjà détenu (une autre instance tourne).
   - Pas de table / migration : les advisory locks vivent en mémoire PG.
   - Best-effort : si la DB est indisponible au moment du tick, on skip sans
     faire échouer le process (même posture que les jobs existants).

   Note perf : on détient une connexion du pool pendant toute la durée de `fn`
   (les advisory locks de session sont attachés à UNE connexion). Le pool
   (max 10) reste dimensionné pour le trafic HTTP ; les ticks sont rares (30 s
   à 12 h) et n'immobilisent qu'une connexion chacun. */

import { pool } from "../db/client.js";

/* Hash stable (FNV-1a / cyrb53 inspiré) → uint32 positif. Passé en texte et
   casté en `::bigint` côté SQL pour éviter toute ambigüité de type avec le
   driver `pg` (les advisory locks acceptent un bigint). */
function hashToUint32(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ (h2 >>> 0)) >>> 0;
}

/**
 * Exécute `fn` sous un verrou advisory Postgres. Renvoie le résultat de `fn`,
 * ou `undefined` si le verrou n'a pas pu être acquis (une autre instance le
 * détient, ou la DB est indisponible → skip silencieux).
 */
export async function withAdvisoryLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const lockKey = String(hashToUint32(key));
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    console.warn(`[lock] pool indisponible pour "${key}", tick ignoré`, err);
    return undefined;
  }

  // Suivi de la libération du verrou : si l'unlock échoue, la connexion détient
  // ENCORE le verrou de session → on la détruira au lieu de la remettre au pool.
  let unlocked = true;
  try {
    let acquired = false;
    try {
      const res = await client.query("SELECT pg_try_advisory_lock($1::bigint) AS ok", [lockKey]);
      acquired = (res.rows[0] as { ok: boolean } | undefined)?.ok === true;
    } catch (err) {
      console.warn(`[lock] échec acquisition pour "${key}", tick ignoré`, err);
      return undefined;
    }
    if (!acquired) return undefined; // une autre instance détient le verrou → skip

    try {
      return await fn();
    } finally {
      unlocked = await client
        .query("SELECT pg_advisory_unlock($1::bigint)", [lockKey])
        .then(() => true)
        .catch((e) => {
          console.warn(`[lock] échec libération pour "${key}"`, e);
          return false;
        });
    }
  } finally {
    // Unlock OK → remise au pool ; unlock en échec → destruction (release(true))
    // pour ne pas empoisonner le pool avec une connexion qui tient le verrou.
    client.release(unlocked ? undefined : true);
  }
}
