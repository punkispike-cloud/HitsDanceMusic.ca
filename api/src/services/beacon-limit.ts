/* Limite anti-abus des beacons publics /v1/track. Le front envoie un heartbeat
   toutes les 20 s (= 3/min par onglet) ; on autorise BEACON_MAX_PER_MIN par
   clientId sur une fenêtre glissante de 60 s. Au-delà, le beacon est silencieu-
   sement droppé (le visiteur reçoit 204, rien n'est ingéré).

   Motivation (audit A3) : /v1/track est public et non authentifié. Le rate-
   limit global (par IP) borne déjà un bot depuis une IP unique ; la limite par
   clientId attrape un bot qui réutilise un même clientId pour injecter de fausses
   secondes d'écoute. Un bot générant un clientId neuf à chaque requête reste
   limité par l'IP (rateLimit global) — les deux gardes se complètent.

   In-memory et borné : un Map clientId -> [timestamps]. Éviction FIFO partielle
   au-delà de MAX_ENTRIES (on dégage les plus anciennes clés) pour éviter la
   croissance infinie tout en évitant un clear total qui re-déclencherait une rafale
   de lookups géo. Pas de Redis → incorrect si >1 réplica (cf. audit C3) ; accepté
   tant que l'API est mono-instance. */

const BEACON_MAX_PER_MIN = 8; // 3/min attendus, marge x2,6
const WINDOW_MS = 60_000;
const MAX_ENTRIES = 20_000;

const hits = new Map<string, number[]>();

/** Éviction FIFO partielle : dégage les plus anciennes clés (insertion-order). */
function evictIfNeeded(): void {
  if (hits.size <= MAX_ENTRIES) return;
  let n = 0;
  for (const k of hits.keys()) {
    hits.delete(k);
    if (++n >= MAX_ENTRIES / 2) break;
  }
}

/**
 * Indique si un beacon de ce clientId est accepté (sous le plafond par minute).
 * Side-effect : enregistre le hit courant si accepté.
 */
export function beaconAllowed(clientId: string, now: number = Date.now()): boolean {
  const arr = hits.get(clientId);
  const recent = arr ? arr.filter((t) => now - t < WINDOW_MS) : [];
  if (recent.length >= BEACON_MAX_PER_MIN) {
    hits.set(clientId, recent); // rafraîchit sans ajouter → reste plafonné
    evictIfNeeded();
    return false;
  }
  recent.push(now);
  hits.set(clientId, recent);
  evictIfNeeded();
  return true;
}

/** Test-only : vide le cache. */
export function resetBeaconLimitForTests(): void {
  hits.clear();
}
