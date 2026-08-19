/* Rapports mensuels d'audience par radio. buildMonthlyReport() agrège les stats
   du mois (réutilise les tables analytics + track_history). runMonthlyReports()
   envoie, en début de mois, le bilan du mois précédent au contact de la radio +
   à l'owner — idempotent via report_log (1 envoi par radio/période). Inactif si
   Resend n'est pas configuré. */

import { eq, and, gte, lt, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  radios,
  users,
  analyticsDaily,
  analyticsShowListen,
  trackHistory,
  reportLog,
} from "../db/schema.js";
import { env, isResendConfigured } from "../env.js";
import { sendEmail, reportEmailHtml, type ReportEmailData } from "./email.js";
import { withAdvisoryLock } from "./lock.js";
import { TRACK_FILTER_RES, cleanTrackLabel } from "./track-labels.js";

const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

function hhmm(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** Construit le rapport d'une radio pour (year, month) — month en base 1. */
export async function buildMonthlyReport(
  radioId: string,
  year: number,
  month: number,
): Promise<ReportEmailData | null> {
  const radio = await db.query.radios.findFirst({ where: eq(radios.id, radioId) });
  if (!radio) return null;

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  /* Agrégat du mois depuis analytics_daily (chaque beacon crédite son jour) :
     l'ancienne somme sur analytics_sessions additionnait le CUMUL DE VIE de
     chaque visiteur vu dans le mois — un habitué depuis mars gonflait chaque
     rapport de tout son historique. Les jours d'analytics_daily sont en date
     locale de la radio, cohérent avec « le mois » du point de vue de l'antenne. */
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const [agg] = await db
    .select({
      listeners: sql<number>`count(distinct ${analyticsDaily.clientId})::int`,
      listenSec: sql<number>`coalesce(sum(${analyticsDaily.listenSec}),0)::int`,
    })
    .from(analyticsDaily)
    .where(
      and(
        eq(analyticsDaily.radioId, radioId),
        gte(analyticsDaily.day, monthStart),
        lt(analyticsDaily.day, nextMonth),
      ),
    );

  const topShows = await db
    .select({
      title: analyticsShowListen.showTitle,
      listeners: sql<number>`count(distinct ${analyticsShowListen.clientId})::int`,
    })
    .from(analyticsShowListen)
    .where(
      and(
        eq(analyticsShowListen.radioId, radioId),
        gte(analyticsShowListen.lastAt, start),
        lt(analyticsShowListen.lastAt, end),
      ),
    )
    .groupBy(analyticsShowListen.showTitle)
    .orderBy(sql`count(distinct ${analyticsShowListen.clientId}) desc`)
    .limit(6);

  /* Même hygiène que la page Stats et l'export CSV (services/track-labels.ts) :
     jingles/liners exclus en SQL, entités décodées et suffixes vidéo retirés à
     la lecture. On récupère large (30) car des variantes du même titre
     fusionnent après nettoyage — puis top 10. */
  const rawTracks = await db
    .select({
      artist: trackHistory.artist,
      title: trackHistory.title,
      plays: sql<number>`count(*)::int`,
    })
    .from(trackHistory)
    .where(
      and(
        eq(trackHistory.radioId, radioId),
        gte(trackHistory.playedAt, start),
        lt(trackHistory.playedAt, end),
        sql`NOT (
             ${trackHistory.title} ~* ${TRACK_FILTER_RES.liner}
          OR ${trackHistory.title} ~* ${TRACK_FILTER_RES.link}
          OR (${trackHistory.title} ~* '24/7' AND ${trackHistory.title} ~* ${TRACK_FILTER_RES.radioWord})
          OR ${trackHistory.title} ~* ${TRACK_FILTER_RES.domain}
          OR ${trackHistory.artist} ~* ${TRACK_FILTER_RES.domain}
        )`,
      ),
    )
    .groupBy(trackHistory.artist, trackHistory.title)
    .orderBy(sql`count(*) desc`)
    .limit(30);

  const mergedTracks = new Map<string, { label: string; plays: number }>();
  for (const t of rawTracks) {
    const artist = cleanTrackLabel(t.artist);
    const title = cleanTrackLabel(t.title);
    if (!title) continue;
    const label = artist ? `${artist} — ${title}` : title;
    const prev = mergedTracks.get(label.toLowerCase());
    if (prev) prev.plays += t.plays;
    else mergedTracks.set(label.toLowerCase(), { label, plays: t.plays });
  }
  const topTracks = [...mergedTracks.values()].sort((a, b) => b.plays - a.plays).slice(0, 10);

  const listeners = agg?.listeners ?? 0;
  const listenSec = agg?.listenSec ?? 0;
  return {
    radioName: radio.name,
    periodLabel: `${MONTHS_FR[month - 1]} ${year}`,
    listeners,
    listenLabel: hhmm(listenSec),
    avgListenLabel: listeners ? hhmm(Math.round(listenSec / listeners)) : null,
    topShows: topShows.map((s) => ({ title: s.title, listeners: s.listeners })),
    topTracks,
    adminUrl: `${env.ADMIN_BASE_URL}/parc/${radioId}`,
  };
}

async function ownerEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.role, "owner"), eq(users.isActive, true)));
  return rows.map((r) => r.email);
}

/** Envoie (une fois) le rapport du mois PRÉCÉDENT à chaque radio active. */
export async function runMonthlyReports(): Promise<void> {
  if (!isResendConfigured()) return;
  const now = new Date();
  if (now.getUTCDate() > 5) return; // les rapports partent en début de mois

  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const year = prev.getUTCFullYear();
  const month = prev.getUTCMonth() + 1;
  const period = `${year}-${String(month).padStart(2, "0")}`;

  try {
    const list = await db.select().from(radios).where(eq(radios.status, "active"));
    const owners = await ownerEmails();
    for (const r of list) {
      const [done] = await db
        .select({ id: reportLog.id })
        .from(reportLog)
        .where(and(eq(reportLog.radioId, r.id), eq(reportLog.period, period)))
        .limit(1);
      if (done) continue;

      const data = await buildMonthlyReport(r.id, year, month);
      if (!data) continue;

      const recipients = [...new Set([...(r.contactEmail ? [r.contactEmail] : []), ...owners])];
      if (!recipients.length) continue;

      const html = reportEmailHtml(data);
      let sentOk = false;
      for (const to of recipients) {
        if (await sendEmail({ to, subject: `📊 ${r.name} — rapport de ${data.periodLabel}`, html })) sentOk = true;
      }
      if (sentOk) {
        await db
          .insert(reportLog)
          .values({ radioId: r.id, period, recipients: recipients.join(", ") })
          .onConflictDoNothing();
        console.log(`[reports] ${r.slug} → rapport ${period} envoyé`);
      }
    }
  } catch (err) {
    console.error("[reports] envoi mensuel échoué (non bloquant)", err);
  }
}

export function startMonthlyReports(): void {
  if (!isResendConfigured()) return;
  // Verrou advisory (C1.2) : une seule instance envoie les rapports (l'idempotence
  // via report_log reste le garde-fou secondaire).
  const run = () => withAdvisoryLock("job:reports", runMonthlyReports);
  setTimeout(() => void run(), 60_000).unref(); // 1 min après le boot
  setInterval(() => void run(), 12 * 60 * 60_000).unref(); // toutes les 12 h
  console.log("[reports] rapports mensuels actifs ✓");
}
