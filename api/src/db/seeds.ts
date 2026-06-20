/* Registre des « bundles » de seed par client (marque).
   Chaque radio démarre avec SON contenu de départ (animateurs / émissions /
   grille) puis l'équipe ajuste tout via l'admin. Le seed initial ne s'applique
   qu'à une base VIERGE (voir seed.ts) → les éditions admin ne sont jamais
   écrasées.

   Ajouter un client = créer un seed-<client>.ts et l'enregistrer ci-dessous.
   Une marque sans bundle (ex. radio générique) démarre vierge : tout se saisit
   alors depuis l'admin. */

import type { SeedArtist, SeedShow, ScheduleRow } from "./seed-data.js";
import {
  SEED_ARTISTS,
  SEED_SHOWS,
  SCHEDULE,
  HOST_TO_ARTIST_SLUG,
} from "./seed-data.js";
import {
  ROCKRADIO_ARTISTS,
  ROCKRADIO_SHOWS,
  ROCKRADIO_SCHEDULE,
  ROCKRADIO_HOST_TO_ARTIST_SLUG,
} from "./seed-rockradio.js";

export interface SeedBundle {
  artists: SeedArtist[];
  shows: SeedShow[];
  schedule: Record<number, ScheduleRow[]>;
  hostToArtistSlug: Record<string, string | null>;
}

const BUNDLES: Record<string, SeedBundle> = {
  hitsdance: {
    artists: SEED_ARTISTS,
    shows: SEED_SHOWS,
    schedule: SCHEDULE,
    hostToArtistSlug: HOST_TO_ARTIST_SLUG,
  },
  rockradio: {
    artists: ROCKRADIO_ARTISTS,
    shows: ROCKRADIO_SHOWS,
    schedule: ROCKRADIO_SCHEDULE,
    hostToArtistSlug: ROCKRADIO_HOST_TO_ARTIST_SLUG,
  },
};

/** Bundle de seed du client (marque), ou null si la marque démarre vierge. */
export function loadSeedBundle(brand: string): SeedBundle | null {
  return BUNDLES[brand] ?? null;
}
