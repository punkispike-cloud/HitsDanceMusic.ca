/* Console OPÉRATEUR (En Ondes). Routes cross-radio scopées au parc entier (pas
   d'adminTenant). Deux axes d'accès :
   - Technique (monitoring parc, santé, alertes, rapports) : owner + it
     (requireItOrOwner).
   - Commercial (création/provisioning d'une radio, forfait/flux/billing) :
     owner seul (requireOwner). `it` ne peut ni créer ni modifier le billing. */

import { Hono } from "hono";
import { z } from "zod";
import { sql, eq, and, inArray, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { radios, artists, shows, analyticsSessions } from "../db/schema.js";
import { requireOwner, requireItOrOwner } from "../middleware/rbac.js";
import { conflict, notFound } from "../lib/errors.js";
import { slugify } from "../lib/validation.js";
import { invalidateRadioCache } from "../services/tenant.js";
import { isAzuraCastConfigured, createStation } from "../services/azuracast.js";
import { buildMonthlyReport } from "../services/reports.js";
import type { AppBindings } from "../types.js";

export const ownerRoutes = new Hono<AppBindings>();

/* GET /v1/owner/overview — totaux agrégés sur TOUT le parc. */
ownerRoutes.get("/overview", requireItOrOwner, async (c) => {
  const [rc] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${radios.status} = 'active')::int`,
      mrr: sql<number>`coalesce(sum(${radios.monthlyPrice}) filter (where ${radios.status} = 'active'), 0)::int`,
    })
    .from(radios);
  const [agg] = await db
    .select({
      sessions: sql<number>`count(*)::int`,
      live: sql<number>`count(*) filter (where ${analyticsSessions.lastSeen} > now() - interval '60 seconds')::int`,
      today: sql<number>`count(*) filter (where ${analyticsSessions.lastSeen} >= date_trunc('day', now()))::int`,
      listenSec: sql<number>`coalesce(sum(${analyticsSessions.listenSec}),0)::int`,
    })
    .from(analyticsSessions);
  return c.json({
    radios: rc?.total ?? 0,
    activeRadios: rc?.active ?? 0,
    mrr: rc?.mrr ?? 0,
    sessions: agg?.sessions ?? 0,
    live: agg?.live ?? 0,
    today: agg?.today ?? 0,
    listenSec: agg?.listenSec ?? 0,
  });
});

/* GET /v1/owner/radios — le parc + KPIs par radio (comparaison radio par radio). */
ownerRoutes.get("/radios", requireItOrOwner, async (c) => {
  const rows = await db.select().from(radios).orderBy(radios.createdAt);

  const sess = await db
    .select({
      radioId: analyticsSessions.radioId,
      live: sql<number>`count(*) filter (where ${analyticsSessions.lastSeen} > now() - interval '60 seconds')::int`,
      today: sql<number>`count(*) filter (where ${analyticsSessions.lastSeen} >= date_trunc('day', now()))::int`,
      sessions: sql<number>`count(*)::int`,
      listenSec: sql<number>`coalesce(sum(${analyticsSessions.listenSec}),0)::int`,
    })
    .from(analyticsSessions)
    .groupBy(analyticsSessions.radioId);
  const sessBy = new Map(sess.map((s) => [s.radioId, s]));

  const art = await db
    .select({ radioId: artists.radioId, n: sql<number>`count(*)::int` })
    .from(artists)
    .groupBy(artists.radioId);
  const artBy = new Map(art.map((a) => [a.radioId, a.n]));

  const shw = await db
    .select({ radioId: shows.radioId, n: sql<number>`count(*)::int` })
    .from(shows)
    .groupBy(shows.radioId);
  const shwBy = new Map(shw.map((s) => [s.radioId, s.n]));

  return c.json(
    rows.map((r) => {
      const s = sessBy.get(r.id);
      return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        status: r.status,
        plan: r.plan,
        domains: r.domains,
        streamUrl: r.streamUrl,
        nowPlayingUrl: r.nowPlayingUrl,
        billingNote: r.billingNote,
        monthlyPrice: r.monthlyPrice,
        contactName: r.contactName,
        contactEmail: r.contactEmail,
        contactPhone: r.contactPhone,
        licenseConfirmed: r.licenseConfirmed,
        healthStatus: r.healthStatus,
        lastCheckedAt: r.lastCheckedAt,
        createdAt: r.createdAt,
        live: s?.live ?? 0,
        today: s?.today ?? 0,
        sessions: s?.sessions ?? 0,
        listenSec: s?.listenSec ?? 0,
        artists: artBy.get(r.id) ?? 0,
        shows: shwBy.get(r.id) ?? 0,
      };
    }),
  );
});

const radioCreate = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().max(60).optional(),
  plan: z.string().trim().max(40).nullish(),
  domains: z.array(z.string().trim().max(200)).optional(),
  streamUrl: z.string().trim().max(500).nullish(),
  nowPlayingUrl: z.string().trim().max(500).nullish(),
  monthlyPrice: z.number().int().min(0).max(100000).nullish(),
  contactName: z.string().trim().max(120).nullish(),
  contactEmail: z.string().trim().max(254).nullish(),
  contactPhone: z.string().trim().max(40).nullish(),
  licenseConfirmed: z.boolean().optional(),
});

/* POST /v1/owner/radios — crée une radio (tenant). Démarre en "provisioning".
   Commercial : owner seul (le provisioning AzuraCast + le forfait relèvent du
   billing). Le branchement du flux AzuraCast viendra en Phase 9. */
ownerRoutes.post("/radios", requireOwner, async (c) => {
  const body = radioCreate.parse(await c.req.json());
  const slug = slugify(body.slug || body.name);
  if (await db.query.radios.findFirst({ where: eq(radios.slug, slug) }))
    throw conflict("Slug déjà utilisé");

  let streamUrl = body.streamUrl ?? null;
  let nowPlayingUrl = body.nowPlayingUrl ?? null;
  let station: { created: boolean; error?: string } = { created: false };
  // Flux managé : si AzuraCast est configuré et qu'aucun flux n'est fourni à la
  // main, on crée automatiquement la station (best-effort — n'empêche jamais la
  // création du tenant).
  if (isAzuraCastConfigured() && !streamUrl) {
    try {
      const s = await createStation(body.name, slug);
      streamUrl = s.streamUrl;
      nowPlayingUrl = s.nowPlayingUrl;
      station = { created: true };
    } catch (err) {
      station = { created: false, error: (err as Error).message };
    }
  }

  const [row] = await db
    .insert(radios)
    .values({
      slug,
      name: body.name,
      plan: body.plan ?? null,
      domains: body.domains ?? [],
      streamUrl,
      nowPlayingUrl,
      monthlyPrice: body.monthlyPrice ?? null,
      contactName: body.contactName ?? null,
      contactEmail: body.contactEmail ?? null,
      contactPhone: body.contactPhone ?? null,
      licenseConfirmed: body.licenseConfirmed ?? false,
      status: "provisioning",
    })
    .returning();
  invalidateRadioCache();
  return c.json({ ...row, station }, 201);
});

const radioPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["active", "provisioning", "paused"]).optional(),
  plan: z.string().trim().max(40).nullish(),
  domains: z.array(z.string().trim().max(200)).optional(),
  streamUrl: z.string().trim().max(500).nullish(),
  nowPlayingUrl: z.string().trim().max(500).nullish(),
  billingNote: z.string().trim().max(2000).nullish(),
  monthlyPrice: z.number().int().min(0).max(100000).nullish(),
  contactName: z.string().trim().max(120).nullish(),
  contactEmail: z.string().trim().max(254).nullish(),
  contactPhone: z.string().trim().max(40).nullish(),
  licenseConfirmed: z.boolean().optional(),
});

/* PATCH /v1/owner/radios/:id — gère une radio (statut, flux, forfait, note).
   Commercial : owner seul (statut/flux/forfait/billing). */
ownerRoutes.patch("/radios/:id", requireOwner, async (c) => {
  const body = radioPatch.parse(await c.req.json());
  const [row] = await db
    .update(radios)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(radios.id, c.req.param("id")))
    .returning();
  if (!row) throw notFound("Radio introuvable");
  invalidateRadioCache();
  return c.json(row);
});

/* GET /v1/owner/health — ping du flux (now-playing/stream) de chaque radio.
   Statut : up | down | none (pas d'URL). Best-effort, timeout 5s, en parallèle. */
ownerRoutes.get("/health", requireItOrOwner, async (c) => {
  const rows = await db
    .select({ id: radios.id, np: radios.nowPlayingUrl, stream: radios.streamUrl })
    .from(radios);
  const checks = await Promise.all(
    rows.map(async (r) => {
      const target = r.np || r.stream;
      if (!target) return { id: r.id, status: "none", ms: null as number | null };
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const start = Date.now();
      try {
        const res = await fetch(target, { signal: ctrl.signal });
        return { id: r.id, status: res.ok ? "up" : "down", ms: Date.now() - start };
      } catch {
        return { id: r.id, status: "down", ms: null as number | null };
      } finally {
        clearTimeout(t);
      }
    }),
  );
  return c.json(checks);
});

/* GET /v1/owner/alerts — radios actives en état problématique (flux down / silence),
   alimenté par le service de surveillance (services/monitor.ts). */
ownerRoutes.get("/alerts", requireItOrOwner, async (c) => {
  const rows = await db
    .select({
      id: radios.id,
      name: radios.name,
      slug: radios.slug,
      healthStatus: radios.healthStatus,
      lastCheckedAt: radios.lastCheckedAt,
      lastAlertAt: radios.lastAlertAt,
      lastAlertKind: radios.lastAlertKind,
    })
    .from(radios)
    .where(and(eq(radios.status, "active"), inArray(radios.healthStatus, ["down", "silent"])))
    .orderBy(desc(radios.lastAlertAt));
  return c.json(rows);
});

/* GET /v1/owner/radios/:id/report?year=&month= — aperçu du rapport mensuel (JSON,
   sans envoi). Défaut : mois précédent. Sert à tester / prévisualiser. */
ownerRoutes.get("/radios/:id/report", requireItOrOwner, async (c) => {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const year = Number(c.req.query("year")) || prev.getUTCFullYear();
  const month = Number(c.req.query("month")) || prev.getUTCMonth() + 1;
  const data = await buildMonthlyReport(c.req.param("id"), year, month);
  if (!data) throw notFound("Radio introuvable");
  return c.json(data);
});

/* GET /v1/owner/timeseries?days=30&radio=<id?> — série quotidienne (visiteurs +
   écoute). Agrégée sur tout le parc, ou scopée à une radio si `radio` fourni. */
ownerRoutes.get("/timeseries", requireItOrOwner, async (c) => {
  const days = Math.min(180, Math.max(1, Number(c.req.query("days")) || 30));
  const radio = c.req.query("radio");
  const radioFilter = radio ? sql`AND s.radio_id = ${radio}` : sql``;
  const result = await db.execute(sql`
    SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
           count(s.id)::int AS sessions,
           coalesce(sum(s.listen_sec), 0)::int AS listen_sec
    FROM generate_series(
           (now() AT TIME ZONE 'America/Toronto')::date - (${days - 1} || ' days')::interval,
           (now() AT TIME ZONE 'America/Toronto')::date,
           interval '1 day'
         ) d
    LEFT JOIN analytics_sessions s
           ON date_trunc('day', s.first_seen AT TIME ZONE 'America/Toronto') = d
          ${radioFilter}
    GROUP BY d
    ORDER BY d
  `);
  return c.json(result.rows);
});
