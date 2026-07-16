/* Bus d'événements analytics (temps réel). Fan-out intra-process : quand un
   beacon arrive (POST /v1/track), on émet un événement par radio ; les clients
   SSE connectés à /v1/admin/analytics/stream pour cette radio sont notifiés et
   poussent un instantané immédiat (au lieu d'attendre le tick périodique).

   Limite : fan-out intra-instance uniquement. En multi-instance (plusieurs
   replicas Railway), un beacon ingéré sur le replica A ne notifie pas un client
   SSE connecté au replica B. Le tick périodique (2 s) du stream reste le repli
   universel : il garantit une fraîcheur ≤ 2 s quel que soit le replica, et gère
   aussi le vieillissement des sessions hors de la fenêtre « en direct » (60 s),
   qui est un changement temporel, pas un événement. */

import { EventEmitter } from "node:events";

const bus = new EventEmitter();
// Les SSE sont nombreux (un listener par client connecté) → on lève la limite
// par défaut (10) et on délègue la gestion du cycle de vie aux désabonnements.
bus.setMaxListeners(0);

const eventFor = (radioId: string) => `beacon:${radioId}`;

/** À appeler après l'ingestion d'un beacon (track.ts). Notifie les stream SSE
 *  de la radio concernée. Best-effort, synchrone, non bloquant. */
export function emitAnalyticsBeacon(radioId: string): void {
  bus.emit(eventFor(radioId));
}

/** S'abonne aux beacons d'une radio. Renvoie une fonction de désabonnement. */
export function onAnalyticsBeacon(radioId: string, fn: () => void): () => void {
  const ev = eventFor(radioId);
  bus.on(ev, fn);
  return () => bus.off(ev, fn);
}
