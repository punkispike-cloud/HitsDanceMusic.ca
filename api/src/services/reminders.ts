/* Rappels automatiques d'émission : chaque minute, repère les créneaux qui
   commencent dans ~10 min (heure de Montréal) et notifie les abonnés Web Push
   de l'émission concernée. Anti-doublon en mémoire (instance unique Railway).
   Totalement inactif si Web Push n'est pas configuré. */

import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { scheduleSlots, shows } from "../db/schema.js";
import { montrealParts } from "./schedule.js";
import { notifyShow } from "./push.js";
import { isPushConfigured, env } from "../env.js";
import { withAdvisoryLock } from "./lock.js";

const LEAD_MIN = 10; // on prévient 10 minutes avant
const sentKeys = new Set<string>(); // `${YYYY-MM-DD}:${slotId}` déjà notifiés

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function tick(): Promise<void> {
  try {
    const { day, hour, minute } = montrealParts(new Date());
    const targetMin = hour * 60 + minute + LEAD_MIN;

    const rows = await db.select().from(scheduleSlots).where(eq(scheduleSlots.dayOfWeek, day));
    const dateKey = todayKey();

    for (const slot of rows) {
      // Fenêtre d'1 minute : le créneau démarre exactement dans LEAD_MIN minutes.
      if (slot.startMin !== targetMin) continue;
      const key = `${dateKey}:${slot.id}`;
      if (sentKeys.has(key)) continue;
      sentKeys.add(key);

      const show = slot.showId
        ? await db.query.shows.findFirst({ where: eq(shows.id, slot.showId) })
        : null;
      const slug = show?.slug;
      if (!slug || !slot.radioId) continue; // pas d'émission/radio → pas d'abonnés ciblables

      const sent = await notifyShow(slot.radioId, slug, {
        title: "🔴 Bientôt en ondes",
        body: `${slot.title} commence dans ${LEAD_MIN} min.`,
        url: env.PUBLIC_SITE_URL,
        tag: `show-${slug}`,
      });
      if (sent > 0) console.log(`[reminders] ${slot.title} → ${sent} notification(s)`);
    }

    // Purge la mémoire à minuit (les clés du jour précédent ne servent plus).
    if (sentKeys.size > 5000) sentKeys.clear();
  } catch (err) {
    console.error("[reminders] tick échoué (non bloquant)", err);
  }
}

export function startReminders(): void {
  if (!isPushConfigured()) return;
  // Verrou advisory (C1.2) : une seule instance notifie par fenêtre d'1 minute.
  setInterval(() => void withAdvisoryLock("job:reminders", tick), 60_000).unref();
  console.log("[reminders] planificateur de rappels actif ✓");
}
