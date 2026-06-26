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
  analyticsSessions,
  analyticsShowListen,
  trackHistory,
  reportLog,
} from "../db/schema.js";
import { env, isResendConfigured } from "../env.js";
import { sendEmail, reportEmailHtml, type ReportEmailData } from "./email.js";

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

  const [agg] = await db
    .select({
      listeners: sql<number>`count(distinct ${analyticsSessions.clientId})::int`,
      listenSec: sql<number>`coalesce(sum(${analyticsSessions.listenSec}),0)::int`,
    })
    .from(analyticsSessions)
    .where(
      and(
        eq(analyticsSessions.radioId, radioId),
        gte(analyticsSessions.lastSeen, start),
        lt(analyticsSessions.lastSeen, end),
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

  const topTracks = await db
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
      ),
    )
    .groupBy(trackHistory.artist, trackHistory.title)
    .orderBy(sql`count(*) desc`)
    .limit(10);

  return {
    radioName: radio.name,
    periodLabel: `${MONTHS_FR[month - 1]} ${year}`,
    listeners: agg?.listeners ?? 0,
    listenLabel: hhmm(agg?.listenSec ?? 0),
    topShows: topShows.map((s) => ({ title: s.title, listeners: s.listeners })),
    topTracks: topTracks.map((t) => ({
      label: t.artist ? `${t.artist} — ${t.title}` : t.title,
      plays: t.plays,
    })),
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
  setTimeout(() => void runMonthlyReports(), 60_000).unref(); // 1 min après le boot
  setInterval(() => void runMonthlyReports(), 12 * 60 * 60_000).unref(); // toutes les 12 h
  console.log("[reports] rapports mensuels actifs ✓");
}
