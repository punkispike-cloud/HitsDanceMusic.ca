/* Notifications Web Push (VAPID). Inactif tant que les clés VAPID ne sont pas
   fournies. Génère les clés une fois avec `npm run vapid`. */

import webpush from "web-push";
import { eq, and, or, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { pushSubscriptions } from "../db/schema.js";
import { env, isPushConfigured } from "../env.js";

let ready = false;

export function initPush(): void {
  if (ready || !isPushConfigured()) return;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  ready = true;
  console.log("[push] Web Push actif ✓");
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Envoie le payload à un lot d'abonnements. Retire les abonnements expirés
 *  (404/410). Factorisé entre rappels d'émission et notification de demande. */
async function sendToSubs(
  radioId: string,
  subs: { id: string; endpoint: string; p256dh: string; auth: string }[],
  payload: PushPayload,
  logTag = "[push]",
): Promise<number> {
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        sent++;
      } catch (err: unknown) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          // Abonnement mort → on nettoie (double scoping id + radio_id, défensif).
          await db
            .delete(pushSubscriptions)
            .where(and(eq(pushSubscriptions.id, s.id), eq(pushSubscriptions.radioId, radioId)))
            .catch(() => {});
        } else {
          console.error(`${logTag} échec envoi`, code ?? err);
        }
      }
    }),
  );
  return sent;
}

/** Envoie une notification à tous les abonnés d'une émission (ou globaux).
   Retire automatiquement les abonnements expirés (404/410). */
export async function notifyShow(radioId: string, showSlug: string, payload: PushPayload): Promise<number> {
  if (!ready) return 0;
  // Toujours scopé à la radio. "__all__" → tous ses abonnés ; sinon les abonnés
  // de l'émission + les abonnés globaux DE CETTE RADIO.
  const subs =
    showSlug === "__all__"
      ? await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.radioId, radioId))
      : await db
          .select()
          .from(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.radioId, radioId),
              or(eq(pushSubscriptions.showSlug, showSlug), isNull(pushSubscriptions.showSlug)),
            ),
          );
  return sendToSubs(radioId, subs, payload);
}

/** Notifie l'auditeur qui a déposé une demande quand elle passe à l'antenne.
 *  Cible ses abonnements push (même clientId, même radio). Aucun envoi tant
 *  que VAPID n'est pas configuré ou qu'aucun abonnement ne correspond. */
export async function notifyRequestPlayed(
  radioId: string,
  clientId: string,
  payload: PushPayload,
): Promise<number> {
  if (!ready) return 0;
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.radioId, radioId), eq(pushSubscriptions.clientId, clientId)));
  return sendToSubs(radioId, subs, payload, "[push:req]");
}
