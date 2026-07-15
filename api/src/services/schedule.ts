/* Sérialisation de la grille au format EXACT attendu par le front (SCHEDULE) :
   { "0": [[from, to, title, host, tag], ...], ... "6": [...] }
   où from/to sont "HH:MM" (et "24:00" pour minuit fin de journée). */

import { asc, eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { scheduleSlots, type ScheduleSlot } from "../db/schema.js";
import { fromMinutes } from "../lib/validation.js";

export type ScheduleTuple = [string, string, string, string, string];
export type ScheduleShape = Record<string, ScheduleTuple[]>;

function tupleOf(s: ScheduleSlot): ScheduleTuple {
  return [fromMinutes(s.startMin), fromMinutes(s.endMin), s.title, s.hostLabel, s.tag];
}

/** Construit l'objet SCHEDULE complet (jours 0..6, triés par heure). */
export async function getScheduleShape(radioId: string): Promise<ScheduleShape> {
  const rows = await db
    .select()
    .from(scheduleSlots)
    .where(eq(scheduleSlots.radioId, radioId))
    .orderBy(asc(scheduleSlots.dayOfWeek), asc(scheduleSlots.startMin));

  const shape: ScheduleShape = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const r of rows) {
    (shape[String(r.dayOfWeek)] ??= []).push(tupleOf(r));
  }
  return shape;
}

/** Slot courant pour l'heure de Montréal (≈ getCurrentSlot du front). */
export async function getCurrentSlot(radioId: string, now = new Date()): Promise<ScheduleSlot | null> {
  const parts = montrealParts(now);
  const nowMin = parts.hour * 60 + parts.minute;
  const rows = await db
    .select()
    .from(scheduleSlots)
    .where(eq(scheduleSlots.radioId, radioId))
    .orderBy(asc(scheduleSlots.dayOfWeek), asc(scheduleSlots.startMin));
  for (const r of rows) {
    if (r.dayOfWeek === parts.day && nowMin >= r.startMin && nowMin < r.endMin) return r;
  }
  return null;
}

/** Prochain créneau après l'heure courante (aujourd'hui plus tard, puis jours
 *  suivants sur 7 jours). Sert le « à venir » du badge live. */
export async function getNextSlot(radioId: string, now = new Date()): Promise<ScheduleSlot | null> {
  const parts = montrealParts(now);
  const nowMin = parts.hour * 60 + parts.minute;
  const rows = await db
    .select()
    .from(scheduleSlots)
    .where(eq(scheduleSlots.radioId, radioId))
    .orderBy(asc(scheduleSlots.dayOfWeek), asc(scheduleSlots.startMin));
  for (let off = 0; off < 7; off++) {
    const d = (parts.day + off) % 7;
    for (const r of rows) {
      if (r.dayOfWeek !== d) continue;
      if (off === 0 && r.startMin <= nowMin) continue;
      return r;
    }
  }
  return null;
}

/** Prochains passages d'un animateur (via le VRAI lien artist_id de la grille,
   pas un matching de chaînes). Renvoie les N prochains créneaux de la semaine. */
export async function getUpcomingSlotsForArtist(artistId: string, radioId: string, limit = 6) {
  const rows = await db
    .select()
    .from(scheduleSlots)
    .where(and(eq(scheduleSlots.artistId, artistId), eq(scheduleSlots.radioId, radioId)))
    .orderBy(asc(scheduleSlots.dayOfWeek), asc(scheduleSlots.startMin));
  if (!rows.length) return [];
  const { day, hour, minute } = montrealParts(new Date());
  const nowMin = hour * 60 + minute;
  const out: { day: number; from: string; to: string; title: string; tag: string }[] = [];
  for (let off = 0; off < 7 && out.length < limit; off++) {
    const d = (day + off) % 7;
    for (const r of rows) {
      if (r.dayOfWeek !== d) continue;
      if (off === 0 && r.startMin <= nowMin) continue;
      out.push({
        day: d,
        from: fromMinutes(r.startMin),
        to: r.endMin === 1440 ? "00:00" : fromMinutes(r.endMin),
        title: r.title,
        tag: r.tag,
      });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Jour/heure/minute pour le fuseau America/Toronto (= Montréal). */
export function montrealParts(date: Date): { day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hourRaw = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = hourRaw === "24" ? 0 : Number(hourRaw);
  return { day: dayMap[wd] ?? 0, hour, minute };
}
