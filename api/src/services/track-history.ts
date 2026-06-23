/* Historique des titres diffusés : interroge le now-playing du flux toutes les
   ~30 s et enregistre chaque changement de titre. Anti-doublon via la dernière
   ligne en DB (tolère l'instance unique Railway). Inactif si NOWPLAYING_URL absent. */

import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { trackHistory } from "../db/schema.js";
import { soleRadioId } from "./tenant.js";
import { env } from "../env.js";

const POLL_MS = 30_000;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function splitArtistTitle(song: string): { artist: string; title: string } | null {
  const s = decodeEntities(song.trim());
  if (!s) return null;
  const i = s.indexOf(" - ");
  if (i > 0) return { artist: s.slice(0, i).trim().slice(0, 200), title: s.slice(i + 3).trim().slice(0, 200) };
  return { artist: "", title: s.slice(0, 200) };
}

/** Parse une réponse now-playing : JSON (Icecast/Azuracast/SHOUTcast v2) ou 7.html. */
function parseNowPlaying(txt: string): { artist: string; title: string } | null {
  const raw = txt.trim();
  if (!raw) return null;
  // 1) JSON : on cherche title/artist (plusieurs shapes connus).
  if (raw[0] === "{" || raw[0] === "[") {
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      const np = (j.now_playing ?? j.current_track ?? j.track ?? j) as Record<string, unknown>;
      const node = (np.song ?? np) as Record<string, unknown>;
      const title = String(node.title ?? node.song ?? node.now_playing_title ?? "");
      const artist = String(node.artist ?? node.now_playing_artist ?? "");
      if (title) return { artist: artist.slice(0, 200), title: title.slice(0, 200) };
    } catch {
      /* pas du JSON valide → on tente le format texte */
    }
  }
  // 2) 7.html SHOUTcast : retirer UNIQUEMENT le wrapper (pas les chevrons d'un titre).
  //    La 7ᵉ colonne CSV (index 6) = « Artiste - Titre ».
  const body = raw.replace(/^<html><body>/i, "").replace(/<\/body><\/html>$/i, "");
  const cols = body.split(",");
  return splitArtistTitle((cols.length >= 7 ? cols.slice(6).join(",") : body).trim());
}

async function tick(): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    // Le timeout couvre AUSSI la lecture du corps (r.text()) : on ne clear qu'à la fin.
    const r = await fetch(env.NOWPLAYING_URL, { signal: ctrl.signal });
    if (!r.ok) return;
    const parsed = parseNowPlaying(await r.text());
    if (!parsed || !parsed.title) return;
    // Poller global = mono-radio seulement ; en multi-radio chaque station a son
    // propre now-playing (résolu au provisioning — Phase 9).
    const radioId = await soleRadioId();
    if (!radioId) return;
    // Anti-doublon : rien si identique au dernier titre de la radio.
    const [last] = await db
      .select()
      .from(trackHistory)
      .where(eq(trackHistory.radioId, radioId))
      .orderBy(desc(trackHistory.playedAt))
      .limit(1);
    if (last && last.artist === parsed.artist && last.title === parsed.title) return;
    await db.insert(trackHistory).values({ radioId, artist: parsed.artist, title: parsed.title });
  } catch {
    /* best-effort — on ne fait jamais échouer le process pour le now-playing */
  } finally {
    clearTimeout(t);
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
