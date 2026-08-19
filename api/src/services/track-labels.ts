/* Nettoyage des métadonnées de flux pour les tops de titres (page Stats,
   rapport mensuel, export CSV). Les titres viennent du now-playing — souvent
   des intitulés de vidéos : entités HTML résiduelles en base (« &apos; »
   inséré avant que le décodage du poller ne soit complet), suffixes vidéo
   « (Official Video) », et jingles/liners de la station comptés comme des
   titres. Le nettoyage se fait À LA LECTURE : les données brutes restent
   intactes en base. Partagé pour que la console, le courriel client et le CSV
   racontent exactement la même chose. */

import { decodeEntities } from "./track-history.js";

/** Retire les segments (…) ou […] qui ne décrivent que la VIDÉO, pas la piste.
 *  Les mentions musicales (remix, mashup, edit…) sont conservées. */
export function stripVideoSuffixes(s: string): string {
  return s
    .replace(
      /\s*[\[(][^\])]*\b(officia?l|video|visuali[sz]er|lyric|lyrics|audio|videoclip|clip|mv|4k|uhd|hd)\b[^\])]*[\])]/gi,
      " ",
    )
    .replace(/\s{2,}/g, " ")
    .replace(/[\s\-–_|·]+$/g, "")
    .trim();
}

export function cleanTrackLabel(s: string): string {
  return stripVideoSuffixes(decodeEntities(s));
}

/** Regex (PostgreSQL, insensibles à la casse) excluant jingles/liners/fallbacks
 *  des tops de titres. `String.raw` : un template ordinaire mangerait les `\`
 *  (`\s` deviendrait `s`). Passées en PARAMÈTRES liés au SQL (`~* ${...}`) →
 *  aucune ré-échappade. Exportées pour que le test exécute LES MÊMES motifs. */
export const TRACK_FILTER_RES = {
  /** Titre entier = mention de direct (« EN DIRECT ! », « LIVE »). */
  liner: String.raw`^\s*(en direct|direct|live)\s*[!.]*\s*$`,
  /** Pistes techniques « LINK », « LINK 1 »… des automates de diffusion. */
  link: String.raw`^\s*link\s*\d*\s*$`,
  /** Mot radio-esque — combiné à « 24/7 » pour épargner un vrai titre « 24/7 ». */
  radioWord: String.raw`\y(radio|music|hits|dance|rock)\y`,
  /** Nom de domaine (HitsDanceMusic.ca…) dans le titre ou l'artiste. */
  domain: String.raw`\y[a-z0-9-]+\.(ca|com|net|org|fm|stream)\y`,
};

export interface TopTrackRow {
  trackId: string;
  artist: string;
  title: string;
  playCount: number;
  likeCount: number;
  listenSec: number | null;
  listeners: number | null;
}

/** Fusion post-nettoyage : après retrait des suffixes vidéo, des variantes du
 *  même titre (« X (Official Video) » / « X [4K] ») se rejoignent. Passages,
 *  likes et secondes s'additionnent (ensembles disjoints par variante) ;
 *  `listeners` prend le MAX — un même auditeur a pu écouter deux variantes,
 *  la somme surcompterait. */
export function mergeTopTracks(rows: TopTrackRow[]): TopTrackRow[] {
  const merged = new Map<string, TopTrackRow>();
  for (const raw of rows) {
    const artist = cleanTrackLabel(raw.artist);
    const title = cleanTrackLabel(raw.title);
    if (!title) continue;
    const key = `${artist.toLowerCase()}|${title.toLowerCase()}`;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...raw, artist, title });
    } else {
      prev.playCount += raw.playCount;
      prev.likeCount += raw.likeCount;
      if (raw.listenSec != null) prev.listenSec = (prev.listenSec ?? 0) + raw.listenSec;
      if (raw.listeners != null) prev.listeners = Math.max(prev.listeners ?? 0, raw.listeners);
    }
  }
  return [...merged.values()]
    .sort(
      (a, b) =>
        b.playCount - a.playCount || b.likeCount - a.likeCount || a.title.localeCompare(b.title),
    )
    .slice(0, 100);
}
