/* Ingestion analytics : upsert de session visiteur + cumul du temps actif /
   temps d'écoute par émission. Conçu pour des « beacons » légers envoyés par
   le front (pageview, heartbeat, listen). Valeurs bornées côté serveur. */

import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { analyticsSessions, analyticsShowListen } from "../db/schema.js";

// Bornes anti-abus : un beacon ne peut pas ajouter plus que l'intervalle prévu.
const MAX_SECONDS_PER_BEACON = 60;

function clampSec(n: unknown): number {
  const v = Math.floor(Number(n) || 0);
  if (v <= 0) return 0;
  return Math.min(v, MAX_SECONDS_PER_BEACON);
}

/** Parse rudimentaire du User-Agent → navigateur + type d'appareil. */
export function parseUserAgent(ua: string): { browser: string; device: string } {
  const s = ua || "";
  let browser = "Autre";
  if (/Edg\//.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/.test(s)) browser = "Opera";
  else if (/Chrome\//.test(s) && !/Chromium/.test(s)) browser = "Chrome";
  else if (/Firefox\//.test(s)) browser = "Firefox";
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = "Safari";
  const device = /Mobi|Android|iPhone|iPad|iPod/.test(s) ? "Mobile" : "Ordinateur";
  return { browser, device };
}

export interface TrackInput {
  clientId: string;
  type: "pageview" | "heartbeat" | "listen";
  showTitle?: string;
  seconds?: number;
  ip: string;
  userAgent: string;
}

export async function ingestTrack(input: TrackInput): Promise<void> {
  const { clientId, type, ip, userAgent } = input;
  const { browser, device } = parseUserAgent(userAgent);
  const now = new Date();

  const activeAdd = type === "heartbeat" || type === "listen" ? clampSec(input.seconds) : 0;
  const listenAdd = type === "listen" ? clampSec(input.seconds) : 0;
  const pageAdd = type === "pageview" ? 1 : 0;

  // Upsert de la session (par client_id). On rafraîchit IP/UA à chaque beacon.
  await db
    .insert(analyticsSessions)
    .values({
      clientId,
      ip,
      userAgent,
      browser,
      device,
      firstSeen: now,
      lastSeen: now,
      activeSec: activeAdd,
      listenSec: listenAdd,
      pageViews: pageAdd,
    })
    .onConflictDoUpdate({
      target: analyticsSessions.clientId,
      set: {
        ip,
        userAgent,
        browser,
        device,
        lastSeen: now,
        activeSec: sql`${analyticsSessions.activeSec} + ${activeAdd}`,
        listenSec: sql`${analyticsSessions.listenSec} + ${listenAdd}`,
        pageViews: sql`${analyticsSessions.pageViews} + ${pageAdd}`,
      },
    });

  // Temps d'écoute par émission (agrégat par paire émission/visiteur).
  if (listenAdd > 0 && input.showTitle) {
    const showTitle = input.showTitle.slice(0, 200);
    await db
      .insert(analyticsShowListen)
      .values({ showTitle, clientId, listenSec: listenAdd, lastAt: now })
      .onConflictDoUpdate({
        target: [analyticsShowListen.showTitle, analyticsShowListen.clientId],
        set: {
          listenSec: sql`${analyticsShowListen.listenSec} + ${listenAdd}`,
          lastAt: now,
        },
      });
  }
}
