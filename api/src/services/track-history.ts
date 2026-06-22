/* Historique des titres diffusés : interroge le now-playing du flux toutes les
   ~30 s et enregistre chaque changement de titre. Anti-doublon via la dernière
   ligne en DB (tolère l'instance unique Railway). Inactif si NOWPLAYING_URL absent. */

import { desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { trackHistory } from "../db/schema.js";
import { env } from "../env.js";

const POLL_MS = 30_000;

/** Parse une réponse now-playing (7.html SHOUTcast ou texte « Artiste - Titre »). */
function parseNowPlaying(txt: string): { artist: string; title: string } | null {
  const clean = txt.replace(/<[^>]+>/g, "").trim();
  if (!clean) return null;
  // 7.html : CSV où la 7ᵉ colonne (index 6) = « Artiste - Titre ».
  const cols = clean.split(",");
  const song = (cols.length >= 7 ? cols.slice(6).join(",") : clean).trim();
  if (!song) return null;
  const i = song.indexOf(" - ");
  if (i > 0) {
    return { artist: song.slice(0, i).trim().slice(0, 200), title: song.slice(i + 3).trim().slice(0, 200) };
  }
  return { artist: "", title: song.slice(0, 200) };
}

async function tick(): Promise<void> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(env.NOWPLAYING_URL, { signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!r.ok) return;
    const parsed = parseNowPlaying(await r.text());
    if (!parsed || !parsed.title) return;
    // Anti-doublon : ne rien insérer si identique au dernier titre enregistré.
    const [last] = await db
      .select()
      .from(trackHistory)
      .orderBy(desc(trackHistory.playedAt))
      .limit(1);
    if (last && last.artist === parsed.artist && last.title === parsed.title) return;
    await db.insert(trackHistory).values({ artist: parsed.artist, title: parsed.title });
  } catch {
    /* best-effort — on ne fait jamais échouer le process pour le now-playing */
  }
}

export function startTrackHistory(): void {
  if (!env.NOWPLAYING_URL) {
    console.warn("[track-history] NOWPLAYING_URL absent — historique des titres inactif.");
    return;
  }
  void tick();
  setInterval(() => void tick(), POLL_MS);
  console.log(`[track-history] poller actif (${POLL_MS / 1000}s) → ${env.NOWPLAYING_URL}`);
}
