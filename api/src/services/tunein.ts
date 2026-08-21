/* Distribution TuneIn — API AIR (Audio Information Reporting).
   Pousse le titre en cours vers TuneIn pour que les auditeurs qui écoutent la
   radio DEPUIS TuneIn voient les bonnes métadonnées, au lieu du nom de station.

   Endpoint (documenté par TuneIn, broadcasters/api/instructions) :
     GET http://air.radiotime.com/Playing.ashx
         ?partnerId=…&partnerKey=…&id=s######&title=…&artist=…

   ⚠ RÈGLE D'USAGE IMPOSÉE PAR TUNEIN : une soumission UNE SEULE FOIS au début
   du morceau. Pas de minuterie, pas de renvoi périodique. C'est pourquoi
   l'appel est branché sur la détection de changement de titre de
   services/track-history.ts et nulle part ailleurs.

   Deux niveaux de configuration, les deux nécessaires :
   - `TUNEIN_PARTNER_ID` + `TUNEIN_PARTNER_KEY` : identifiants du PARTENAIRE
     (En Ondes), obtenus auprès de broadcaster-support@tunein.com. Env, communs
     à toutes les radios.
   - `distribution.tuneinStationId` sur la radio : l'id de SA station TuneIn
     (préfixe « s » compris, ex. s123456). Par radio, en base — pas de migration,
     la colonne jsonb `radios.distribution` existe déjà pour ça.

   Inactif tant que les trois ne sont pas réunis : la fonction sort en silence. */

import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { radios } from "../db/schema.js";
import { env } from "../env.js";

const AIR_ENDPOINT = "https://air.radiotime.com/Playing.ashx";

/** Partenaire configuré ? (condition nécessaire, pas suffisante : il faut aussi
 *  un id de station sur la radio concernée). */
export function isTuneInConfigured(): boolean {
  return Boolean(env.TUNEIN_PARTNER_ID && env.TUNEIN_PARTNER_KEY);
}

/** Id de station TuneIn d'une radio, ou null. Lu dans le jsonb `distribution`,
 *  qui sert déjà de fourre-tout d'inscriptions externes. */
export async function tuneInStationId(radioId: string): Promise<string | null> {
  const [row] = await db
    .select({ distribution: radios.distribution })
    .from(radios)
    .where(eq(radios.id, radioId));
  if (!row) return null;
  const dist = (row.distribution as Record<string, unknown> | null) ?? {};
  const id = typeof dist.tuneinStationId === "string" ? dist.tuneinStationId.trim() : "";
  return id || null;
}

/** Construit l'URL AIR. Exporté pour être testable sans réseau. */
export function buildAirUrl(
  stationId: string,
  artist: string,
  title: string,
  partnerId = env.TUNEIN_PARTNER_ID,
  partnerKey = env.TUNEIN_PARTNER_KEY,
): string {
  const qs = new URLSearchParams({
    partnerId,
    partnerKey,
    id: stationId,
    title,
    // `artist` reste envoyé même vide : TuneIn accepte le paramètre et cela
    // efface l'artiste précédent au lieu de le laisser traîner sur le titre suivant.
    artist,
  });
  return `${AIR_ENDPOINT}?${qs.toString()}`;
}

/* Un titre parasite (jingle, pub, nom de station) ne doit pas partir chez
   TuneIn : il resterait affiché jusqu'au morceau suivant. On applique le même
   filtre que l'affichage public. */
function isRealTrack(artist: string, title: string): boolean {
  if (!title.trim()) return false;
  const t = `${artist} ${title}`.toLowerCase();
  return !/jingle|publicit|\bpub\b|station id|identification/.test(t);
}

/* Un échec réseau ne doit pas noyer les logs : TuneIn peut être indisponible
   plusieurs minutes et le poller tourne en continu. On ne journalise qu'au
   passage en échec, pas à chaque tentative. */
let lastFailureLogged = false;

/**
 * Pousse le titre en cours vers TuneIn. Best-effort et non bloquant :
 * n'échoue jamais, ne fait jamais échouer l'appelant.
 *
 * À n'appeler QUE sur un changement de titre avéré (règle TuneIn ci-dessus).
 */
export async function pushNowPlaying(radioId: string, artist: string, title: string): Promise<void> {
  if (!isTuneInConfigured()) return;
  if (!isRealTrack(artist, title)) return;

  const stationId = await tuneInStationId(radioId).catch(() => null);
  if (!stationId) return;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(buildAirUrl(stationId, artist, title), { signal: ctrl.signal });
    // Seul le statut compte : annuler le corps libère la connexion tout de suite.
    r.body?.cancel().catch(() => {});
    if (!r.ok) {
      if (!lastFailureLogged) {
        console.warn(`[tunein] AIR a répondu ${r.status} pour la station ${stationId}`);
        lastFailureLogged = true;
      }
      return;
    }
    lastFailureLogged = false;
  } catch (err) {
    if (!lastFailureLogged) {
      console.warn("[tunein] envoi AIR impossible", err);
      lastFailureLogged = true;
    }
  } finally {
    clearTimeout(t);
  }
}
