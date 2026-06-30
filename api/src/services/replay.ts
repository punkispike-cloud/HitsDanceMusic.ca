/* Replay / catch-up des directs : ingère les enregistrements AzuraCast en
   brouillons d'épisodes (status "draft") pour qu'un éditeur les polit avant
   publication. Entièrement GATED : no-op sauf si AzuraCast est configuré ET le
   flag AZURACAST_REPLAY_ENABLED actif (cf. isReplayEnabled).

   Calque le pattern des autres jobs d'arrière-plan (instance unique via verrou
   advisory, best-effort, jamais bloquant) :
   - boot différé (30 s) puis tick à REPLAY_INTERVAL_MS ;
   - wrapé par withAdvisoryLock("job:replay", …) → une seule instance ingère.

   Sélection des radios : seules les radios actives dont le now-playing pointe
   vers AzuraCast ont une station provisionnée (createStation pose
   nowPlayingUrl = {base}/api/nowplaying/{slug}) → short_name = slug.

   Idempotence : un épisode draft existant pour la même radio avec le même
   audioUrl (URL de téléchargement unique par enregistrement), ou le même titre,
   → on skip. Un échec de slug unique (conflit) est aussi traité comme un doublon.

   artistId (NOT NULL sur episodes) : la 1re artiste (sortOrder) de la radio sert
   de placeholder, réassignable par l'éditeur. Aucune artiste → on skip (le
   brouillon ne peut pas exister sans auteur). */

import { and, eq, or, asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { radios, episodes, artists } from "../db/schema.js";
import { env, isReplayEnabled } from "../env.js";
import { isAzuraCastConfigured, listRecordings } from "./azuracast.js";
import { withAdvisoryLock } from "./lock.js";
import { slugify } from "../lib/validation.js";

function dateStamp(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Première artiste (sortOrder) d'une radio — placeholder d'affectation du
 *  brouillon, réassignable par l'éditeur. null si la radio n'a aucun artiste. */
async function firstArtist(radioId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: artists.id })
    .from(artists)
    .where(eq(artists.radioId, radioId))
    .orderBy(asc(artists.sortOrder), asc(artists.id))
    .limit(1);
  return row?.id ?? null;
}

async function tick(): Promise<void> {
  const acBase = env.AZURACAST_BASE_URL.replace(/\/$/, "");
  const rows = await db.select().from(radios).where(eq(radios.status, "active"));
  let created = 0;
  let skipped = 0;

  for (const r of rows) {
    // now-playing pointant vers AzuraCast ⇒ station provisionnée (short_name = slug).
    if (!r.nowPlayingUrl || !r.nowPlayingUrl.startsWith(acBase)) continue;

    let recs;
    try {
      recs = await listRecordings(r.slug);
    } catch (err) {
      // 404 / station sans enregistrements / API non disponible → skip silencieux.
      console.debug(`[replay] ${r.slug}: enregistrements indisponibles (${(err as Error).message})`);
      continue;
    }
    if (recs.length === 0) continue;

    const artistId = await firstArtist(r.id);
    if (!artistId) {
      console.warn(
        `[replay] ${r.slug}: aucun artiste → ${recs.length} enregistrement(s) ignoré(s) (artistId requis sur episodes)`,
      );
      skipped += recs.length;
      continue;
    }

    for (const rec of recs) {
      // Idempotence : draft existant pour la même radio avec le même audioUrl
      // (ou même titre si l'URL est vide) → on skip.
      const dup = await db.query.episodes.findFirst({
        where: and(
          eq(episodes.radioId, r.id),
          rec.audioUrl
            ? or(eq(episodes.audioUrl, rec.audioUrl), eq(episodes.title, rec.title))
            : eq(episodes.title, rec.title),
        ),
      });
      if (dup) {
        skipped++;
        continue;
      }
      const stamp = rec.recordedAt ? dateStamp(rec.recordedAt) : dateStamp(new Date());
      const slug = slugify(`${rec.title} ${stamp}`);
      try {
        await db.insert(episodes).values({
          radioId: r.id,
          slug,
          artistId,
          title: rec.title,
          description: "Replay du direct — à vérifier, metadata et couverture à compléter avant publication.",
          audioUrl: rec.audioUrl,
          durationSec: rec.durationSec,
          sizeBytes: rec.sizeBytes,
          status: "draft",
        });
        created++;
      } catch (err) {
        // Conflit d'unicité (slug par radio) → traité comme un doublon (skip).
        skipped++;
        console.debug(`[replay] ${r.slug}: épisode « ${rec.title} » ignoré (${(err as Error).message})`);
      }
    }
  }

  if (created || skipped) {
    console.log(`[replay] brouillons créés : ${created}, ignorés (doublons) : ${skipped}`);
  }
}

/** Démarre le replay : une fois au boot (différé 30 s) puis à REPLAY_INTERVAL_MS.
 *  No-op si la fonctionnalité est désactivée (gate isReplayEnabled). Le tick est
 *  wrappé par un verrou advisory (C1.2) : une seule instance ingère à la fois. */
export function startReplay(): void {
  if (!isReplayEnabled()) return;
  if (!isAzuraCastConfigured()) return; // garde défensive (déjà couvert par isReplayEnabled)
  const run = () => withAdvisoryLock("job:replay", tick);
  setTimeout(() => void run(), 30_000).unref();
  setInterval(() => void run(), env.REPLAY_INTERVAL_MS).unref();
  console.log(`[replay] catch-up des directs actif (${Math.round(env.REPLAY_INTERVAL_MS / 1000)}s)`);
}
