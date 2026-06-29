/* Surveillance du flux de chaque radio active : détecte un flux INJOIGNABLE
   (le fetch échoue) ou un SILENCE prolongé (aucun changement de titre depuis
   STREAM_SILENCE_MIN). Met à jour radios.health_status à chaque passage et, sur
   TRANSITION vers un état problématique (debouncée), alerte l'owner + le contact
   par courriel (uniquement si Resend est configuré). Calque le pattern des autres
   jobs d'arrière-plan (instance unique Railway, best-effort, jamais bloquant). */

import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { radios, trackHistory, users } from "../db/schema.js";
import type { Radio } from "../db/schema.js";
import { env, isMonitorEnabled, isResendConfigured } from "../env.js";
import { sendEmail, alertEmailHtml } from "./email.js";
import { withAdvisoryLock } from "./lock.js";

type Health = "up" | "down" | "silent" | "unknown";

async function reachable(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function ownerEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.role, "owner"), eq(users.isActive, true)));
  return rows.map((r) => r.email);
}

async function alert(radio: Radio, kind: "down" | "silent"): Promise<void> {
  if (!isResendConfigured()) return; // pas de canal courriel → l'état reste suivi, sans envoi
  const detail =
    kind === "down"
      ? `Le flux de ${radio.name} ne répond pas (${radio.nowPlayingUrl || radio.streamUrl}). Vérifie l'hébergeur.`
      : `Aucun changement de titre sur ${radio.name} depuis plus de ${env.STREAM_SILENCE_MIN} min — silence/dead-air possible.`;
  const to = [...new Set([...(await ownerEmails()), ...(radio.contactEmail ? [radio.contactEmail] : [])])];
  const html = alertEmailHtml(radio.name, kind, detail);
  const subject = kind === "down" ? `🔴 ${radio.name} hors ligne` : `🟠 ${radio.name} silence détecté`;
  for (const addr of to) await sendEmail({ to: addr, subject, html });
}

async function tick(): Promise<void> {
  try {
    const rows = await db.select().from(radios).where(eq(radios.status, "active"));
    for (const r of rows) {
      const target = r.nowPlayingUrl || r.streamUrl;
      if (!target) continue; // pas de flux à surveiller

      const up = await reachable(target);
      let status: Health;
      if (!up) {
        status = "down";
      } else if (r.nowPlayingUrl) {
        // Silence : on ne peut le déduire que si on poll le now-playing (→ track_history).
        const [last] = await db
          .select({ at: trackHistory.playedAt })
          .from(trackHistory)
          .where(eq(trackHistory.radioId, r.id))
          .orderBy(desc(trackHistory.playedAt))
          .limit(1);
        // last absent ⇒ on ne conclut pas au silence (poller pas encore passé).
        const ageMin = last ? (Date.now() - last.at.getTime()) / 60_000 : 0;
        status = ageMin > env.STREAM_SILENCE_MIN ? "silent" : "up";
      } else {
        status = "up";
      }

      const prev = r.healthStatus as Health;
      await db.update(radios).set({ healthStatus: status, lastCheckedAt: new Date() }).where(eq(radios.id, r.id));

      // Alerte seulement sur transition vers un état problématique, et debouncée.
      const lastAlertMs = r.lastAlertAt ? r.lastAlertAt.getTime() : 0;
      const cooled = Date.now() - lastAlertMs >= env.ALERT_DEBOUNCE_MIN * 60_000;
      if ((status === "down" || status === "silent") && status !== prev && cooled) {
        await alert(r, status);
        await db.update(radios).set({ lastAlertAt: new Date(), lastAlertKind: status }).where(eq(radios.id, r.id));
        console.warn(`[monitor] alerte ${status} → ${r.slug}`);
      }
    }
  } catch (err) {
    console.error("[monitor] tick échoué (non bloquant)", err);
  }
}

export function startMonitor(): void {
  if (!isMonitorEnabled()) return;
  // Verrou advisory (C1.2) : une seule instance surveille les flux à la fois.
  const run = () => withAdvisoryLock("job:monitor", tick);
  void run();
  setInterval(() => void run(), env.MONITOR_INTERVAL_MS).unref();
  console.log(`[monitor] surveillance du flux active (${Math.round(env.MONITOR_INTERVAL_MS / 1000)}s)`);
}
