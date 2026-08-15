/* Rappels automatiques d'émission : chaque minute, repère les créneaux qui
   commencent dans ~10 min (heure de Montréal) et notifie les abonnés Web Push
   de l'émission concernée. Anti-doublon PARTAGÉ en DB (table reminder_log, unicité
   (slot, jour)) → sûr en multi-instance. Totalement inactif si Web Push absent. */

import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { scheduleSlots, shows, reminderLog } from "../db/schema.js";
import { montrealParts } from "./schedule.js";
import { notifyShow } from "./push.js";
import { isPushConfigured, env } from "../env.js";
import { withAdvisoryLock } from "./lock.js";

const LEAD_MIN = 10; // on prévient 10 minutes avant
const MINS_PER_DAY = 1440;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function tick(): Promise<void> {
  try {
    const { day, hour, minute } = montrealParts(new Date());
    // Cible = maintenant + LEAD_MIN. Gère le passage minuit : à 23:5x, la cible
    // « déborde » sur le jour suivant (ex. 23:55 → 00:05 le lendemain, autre
    // dayOfWeek) — sans ce wrap, les émissions démarrant 00:00–00:09 n'avaient
    // jamais de rappel.
    const rawTarget = hour * 60 + minute + LEAD_MIN;
    const targetMin = rawTarget % MINS_PER_DAY;
    const targetDay = rawTarget >= MINS_PER_DAY ? (day + 1) % 7 : day;

    // Créneaux démarrant exactement dans LEAD_MIN minutes (fenêtre d'1 min).
    const rows = await db
      .select()
      .from(scheduleSlots)
      .where(and(eq(scheduleSlots.dayOfWeek, targetDay), eq(scheduleSlots.startMin, targetMin)));
    const dateKey = todayKey();

    for (const slot of rows) {
      // Dedup PARTAGÉ entre instances : réserver (slot, date) via INSERT ON CONFLICT
      // DO NOTHING. Si 0 ligne insérée → une autre instance/tick a déjà notifié ce
      // créneau aujourd'hui → on passe. Remplace l'ancien Set en mémoire process qui
      // dupliquait les push dès qu'il y avait ≥ 2 instances.
      const claimed = await db
        .insert(reminderLog)
        .values({ slotId: slot.id, reminderDate: dateKey, radioId: slot.radioId ?? null })
        .onConflictDoNothing({ target: [reminderLog.slotId, reminderLog.reminderDate] })
        .returning({ id: reminderLog.id });
      if (claimed.length === 0) continue;

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
