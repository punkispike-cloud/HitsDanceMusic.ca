/* Historique des titres diffusés : interroge le now-playing du flux toutes les
   ~30 s et enregistre chaque changement de titre. Anti-doublon via la dernière
   ligne en DB (tolère l'instance unique Railway). Inactif si NOWPLAYING_URL absent. */

import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { trackHistory, radios } from "../db/schema.js";
import { env } from "../env.js";
import { withAdvisoryLock } from "./lock.js";

const POLL_MS = 30_000;

/** Décode les entités HTML usuelles des métadonnées de flux. Exporté : la
 *  lecture (top titres) doit aussi décoder — l'historique déjà en base contient
 *  des entités insérées avant que ce décodage ne soit complet (`&apos;`…). */
export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&"); // en dernier : sinon &amp;apos; se décoderait deux fois
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
      // Décodage ici aussi : certains now-playing JSON (relais, agrégateurs)
      // livrent des entités HTML — seul le chemin 7.html décodait jusqu'ici.
      const title = decodeEntities(String(node.title ?? node.song ?? node.now_playing_title ?? ""));
      const artist = decodeEntities(String(node.artist ?? node.now_playing_artist ?? ""));
      if (title) return { artist: artist.trim().slice(0, 200), title: title.trim().slice(0, 200) };
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

/** Interroge le now-playing d'UNE radio et enregistre le titre s'il a changé. */
async function pollRadio(radioId: string, url: string): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    // Le timeout couvre AUSSI la lecture du corps (r.text()) : on ne clear qu'à la fin.
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return;
    const parsed = parseNowPlaying(await r.text());
    if (!parsed || !parsed.title) return;
    // Anti-doublon : rien si identique au dernier titre DE CETTE radio.
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

/** Cibles à interroger : chaque radio ACTIVE avec un now_playing_url. En
   mono-radio sans URL en base, on retombe sur env.NOWPLAYING_URL (compat Hits Dance). */
async function pollTargets(): Promise<{ radioId: string; url: string }[]> {
  const rows = await db
    .select({ id: radios.id, url: radios.nowPlayingUrl, status: radios.status })
    .from(radios);
  const active = rows.filter((r) => r.status === "active");
  const out = active.filter((r) => r.url).map((r) => ({ radioId: r.id, url: r.url! }));
  if (out.length === 0 && active.length === 1 && env.NOWPLAYING_URL) {
    out.push({ radioId: active[0]!.id, url: env.NOWPLAYING_URL });
  }
  return out;
}

async function tick(): Promise<void> {
  let list: { radioId: string; url: string }[] = [];
  try {
    list = await pollTargets();
  } catch {
    return; // best-effort
  }
  // Sérialisé : on ne martèle pas N stations simultanément.
  for (const { radioId, url } of list) {
    await pollRadio(radioId, url);
  }
}

export function startTrackHistory(): void {
  // Verrou advisory (C1.2) : en multi-instance, une seule instance poll le
  // now-playing à la fois (évite le double insert d'un même titre).
  void withAdvisoryLock("job:track-history", tick);
  setInterval(() => void withAdvisoryLock("job:track-history", tick), POLL_MS);
  console.log(`[track-history] poller actif (${POLL_MS / 1000}s, par radio active)`);
}
