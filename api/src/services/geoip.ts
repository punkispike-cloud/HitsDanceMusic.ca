/* Résolution géo-IP locale (A5).
 *
 * Par défaut, AUCUNE fuite d'IP visiteur vers un tiers : on ne fait plus d'appel
 * à geojs.io / freeipapi.com / ipwho.is (qui exposaient les IP des visiteurs à
 * un service externe, sans consentement ni contrôle). La carte audience est
 * simplement vide tant qu'aucune base locale n'est configurée.
 *
 * Pour ré-activer la géo SANS fuite : auto-héberger une base MaxMind GeoLite2
 * (gratuit, compte MaxMind requis pour télécharger le .mmdb), installer le
 * lecteur dans l'API (`npm i maxmind` dans api/) et poser `GEOIP_DB_PATH` vers
 * le fichier GeoLite2-City.mmdb. La résolution est alors 100 % locale (l'IP ne
 * quitte jamais l'infra). Le lecteur est chargé paresseusement (dynamic import)
 * → l'API démarre même si `maxmind` n'est pas installé (renvoie null).
 *
 * Le .mmdb n'est PAS commité (trop gros, et la licence MaxMind l'interdit) ;
 * il est monté dans le conteneur Railway via un volume ou téléchargé au build.
 *
 * `maxmind` est délibérément absent des dépendances : son import est dynamique
 * et non typé ici pour ne pas casser le build/CI quand le paquet n'est pas
 * installé (cas par défaut). L'opérateur qui active la géo l'installe à part. */

import { env } from "../env.js";

export type GeoResult = { city?: string; country?: string; lat?: number; lon?: number };

/** Forme minimale d'une réponse MaxMind City (champs utilisés). */
interface MaxmindCity {
  city?: { names?: { en?: string } };
  country?: { names?: { en?: string } };
  registered_country?: { names?: { en?: string } };
  location?: { latitude?: number; longitude?: number };
}
interface MaxmindReader {
  get: (ip: string) => MaxmindCity | null;
}
interface MaxmindModule {
  open?: (path: string) => Promise<MaxmindReader | null>;
}

// Cache du lecteur MaxMind (ouvert une fois au premier usage).
type Reader = (ip: string) => GeoResult | null;
let _reader: Reader | null | undefined;

async function getReader(): Promise<Reader | null> {
  if (_reader !== undefined) return _reader;
  if (!env.GEOIP_DB_PATH) {
    _reader = null;
    return null;
  }
  try {
    // Dynamic import non typé : si `maxmind` n'est pas installé, on dégrade (null).
    // Spécificateur non-littéral → TS ne résout pas le module (dépendance optionnelle
    // absente par défaut) ; résolu à l'exécution seulement.
    const modName = "maxmind";
    const mod = (await import(modName)) as MaxmindModule;
    if (!mod.open) throw new Error("module maxmind sans export open()");
    const r = await mod.open(env.GEOIP_DB_PATH);
    if (!r) throw new Error("ouverture du .mmdb impossible");
    _reader = (ip: string): GeoResult | null => {
      const c = r.get(ip);
      if (!c) return null;
      const city = c.city?.names?.en;
      const country = c.country?.names?.en ?? c.registered_country?.names?.en;
      const lat = c.location?.latitude;
      const lon = c.location?.longitude;
      if (!city && !country && lat === undefined && lon === undefined) return null;
      return { city, country, lat, lon };
    };
  } catch (err) {
    console.warn("[geoip] MaxMind indisponible (GEOIP_DB_PATH=" + env.GEOIP_DB_PATH + ") — géo désactivée", err);
    _reader = null;
  }
  return _reader;
}

/** Résout { ville, pays, lat, lon } localement (MaxMind) ou renvoie null si
 *  aucune base n'est configurée. N'effectue JAMAIS d'appel réseau vers un tiers. */
export async function resolveGeo(ip: string): Promise<GeoResult | null> {
  if (!ip) return null;
  const reader = await getReader();
  if (!reader) return null;
  return reader(ip);
}
