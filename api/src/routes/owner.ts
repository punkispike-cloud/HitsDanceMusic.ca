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
import { radios, artists, shows, analyticsSessions, subscriptions, users } from "../db/schema.js";
import { requireOwner, requireItOrOwner } from "../middleware/rbac.js";
import { conflict, notFound, badRequest } from "../lib/errors.js";
import { slugify } from "../lib/validation.js";
import { invalidateRadioCache } from "../services/tenant.js";
import { isAzuraCastConfigured, createStation } from "../services/azuracast.js";
import { buildMonthlyReport } from "../services/reports.js";
import { isStripeBillingConfigured } from "../env.js";
import { createCheckoutSession, createPortalSession, BILLABLE_TIERS, tierToPriceId } from "../services/stripe.js";
import { hashPassword } from "../lib/password.js";
import { randomBytes } from "node:crypto";
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
      // « aujourd'hui » au fuseau America/Toronto (cohérent avec /timeseries et
      // /admin/analytics/overview) plutôt que minuit du fuseau de session (UTC).
      today: sql<number>`count(*) filter (where (last_seen AT TIME ZONE 'America/Toronto')::date = (now() AT TIME ZONE 'America/Toronto')::date)::int`,
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
      today: sql<number>`count(*) filter (where (last_seen AT TIME ZONE 'America/Toronto')::date = (now() AT TIME ZONE 'America/Toronto')::date)::int`,
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
  // Provisioning enrichi (A3) : superadmin du nouveau tenant + abonnement trial.
  superadminEmail: z.string().trim().max(254).nullish(),
  superadminName: z.string().trim().max(120).nullish(),
  superadminPassword: z.string().trim().min(8).max(200).nullish(),
  createSubscription: z.boolean().optional(), // crée une ligne subscriptions (trialing)
});

function randomTempPassword(): string {
  // 16 octets url-safe — retourné UNE fois à l'opérateur (à transmettre au client).
  return randomBytes(16).toString("base64url").slice(0, 22);
}

/* POST /v1/owner/radios — crée une radio (tenant). Démarre en "provisioning".
   Commercial : owner seul. Provisioning enrichi (A3) : crée optionnellement le
   superadmin du tenant (compte + mot de passe temporaire) et une ligne
   d'abonnement « trialing » (intention de facturation ; le vrai paiement Stripe
   se fait via /billing/checkout par le client). Le branchement du flux AzuraCast
   + l'envoi d'un e-mail d'invitation viendront en Phase 9 / service mail. */
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
  if (!row) throw new Error("Échec création radio");

  // Superadmin du nouveau tenant (idempotent sur l'e-mail : re-rattache au tenant).
  let superadmin: { id: string; email: string; tempPassword?: string } | null = null;
  if (body.superadminEmail) {
    const tempPassword = body.superadminPassword ? null : randomTempPassword();
    const passwordHash = await hashPassword(body.superadminPassword || tempPassword || randomTempPassword());
    const [u] = await db
      .insert(users)
      .values({
        email: body.superadminEmail.toLowerCase(),
        passwordHash,
        displayName: body.superadminName || body.name,
        role: "superadmin",
        radioId: row.id,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          passwordHash,
          displayName: body.superadminName || body.name,
          role: "superadmin",
          radioId: row.id,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning({ id: users.id, email: users.email });
    if (!u) throw new Error("Échec création superadmin");
    superadmin = { id: u.id, email: u.email, ...(tempPassword ? { tempPassword } : {}) };
  }

  // Abonnement « trialing » (intention de facturation — pas un paiement Stripe).
  // Sert de miroir local tant que le client ne passe pas par /billing/checkout.
  let subscription: { planTier: string; status: string } | null = null;
  if (body.createSubscription && body.plan) {
    const [s] = await db
      .insert(subscriptions)
      .values({ radioId: row.id, planTier: body.plan, status: "trialing" })
      .onConflictDoUpdate({
        target: subscriptions.radioId,
        set: { planTier: body.plan, status: "trialing", updatedAt: new Date() },
      })
      .returning({ planTier: subscriptions.planTier, status: subscriptions.status });
    if (!s) throw new Error("Échec création abonnement");
    subscription = { planTier: s.planTier, status: s.status };
  }

  invalidateRadioCache();
  return c.json({ ...row, station, superadmin, subscription }, 201);
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

/* ═══════════════════════ DISTRIBUTION (TuneIn / Radio Garden / Alexa / podcasts) ═══════════════════════
   Outil d'inscription de la radio sur les plateformes externes. GET renvoie un
   « colis » de métadonnées copiables (nom, flux, now-playing, domaines) + une
   checklist dont l'état coché est persisté dans radios.distribution (jsonb).
   PATCH = jsonb merge sur `checklist`. Console owner/it (cross-radio). */

const DISTRIBUTION_CHANNELS: { key: string; label: string }[] = [
  { key: "tunein", label: "TuneIn" },
  { key: "radiogarden", label: "Radio Garden" },
  { key: "alexa", label: "Skill Alexa (manifeste)" },
  { key: "applePodcasts", label: "Apple Podcasts" },
  { key: "googlePodcasts", label: "Google Podcasts" },
];

/* GET /v1/owner/radios/:id/distribution — colis de métadonnées + checklist. */
ownerRoutes.get("/radios/:id/distribution", requireItOrOwner, async (c) => {
  const [radio] = await db
    .select({
      name: radios.name,
      slug: radios.slug,
      streamUrl: radios.streamUrl,
      nowPlayingUrl: radios.nowPlayingUrl,
      domains: radios.domains,
      distribution: radios.distribution,
    })
    .from(radios)
    .where(eq(radios.id, c.req.param("id")));
  if (!radio) throw notFound("Radio introuvable");
  const dist = (radio.distribution as Record<string, unknown> | null) ?? {};
  const checklistState = (dist.checklist ?? {}) as Record<string, boolean>;
  return c.json({
    package: {
      name: radio.name,
      slug: radio.slug,
      streamUrl: radio.streamUrl,
      nowPlayingUrl: radio.nowPlayingUrl,
      domains: radio.domains,
    },
    checklist: DISTRIBUTION_CHANNELS.map((ch) => ({
      key: ch.key,
      label: ch.label,
      done: !!checklistState[ch.key],
    })),
  });
});

const distributionPatch = z.object({
  checklist: z.record(z.boolean()).optional(),
});

/* PATCH /v1/owner/radios/:id/distribution — enregistre l'état coché (jsonb merge
   sur `checklist` : préserve les autres clés de `distribution`). */
ownerRoutes.patch("/radios/:id/distribution", requireItOrOwner, async (c) => {
  const id = c.req.param("id");
  const body = distributionPatch.parse(await c.req.json());
  const [radio] = await db
    .select({ distribution: radios.distribution })
    .from(radios)
    .where(eq(radios.id, id));
  if (!radio) throw notFound("Radio introuvable");
  const dist = (radio.distribution as Record<string, unknown> | null) ?? {};
  const existingChecklist = (dist.checklist ?? {}) as Record<string, boolean>;
  const merged: Record<string, unknown> = {
    ...dist,
    checklist: { ...existingChecklist, ...(body.checklist ?? {}) },
  };
  const [row] = await db
    .update(radios)
    .set({ distribution: merged, updatedAt: new Date() })
    .where(eq(radios.id, id))
    .returning({ distribution: radios.distribution });
  const newDist = (row?.distribution as Record<string, unknown> | null) ?? null;
  const newChecklist = (newDist?.checklist ?? {}) as Record<string, boolean>;
  return c.json({
    checklist: DISTRIBUTION_CHANNELS.map((ch) => ({
      key: ch.key,
      label: ch.label,
      done: !!newChecklist[ch.key],
    })),
  });
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

/* GET /v1/owner/radios/:id/billing — abonnement (miroir Stripe) d'une radio.
   Lecture seule (owner + it). La création/mise à jour vient du webhook Stripe
   (POST /v1/webhooks/stripe, à brancher avec la lib stripe + STRIPE_WEBHOOK_SECRET). */
ownerRoutes.get("/radios/:id/billing", requireItOrOwner, async (c) => {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.radioId, c.req.param("id")))
    .limit(1);
  if (!row) throw notFound("Aucun abonnement pour cette radio");
  return c.json(row);
});

const billingCheckout = z.object({
  tier: z.enum(["starter", "growth", "pro"]),
  returnUrl: z.string().trim().min(1).max(500),
});

/* POST /v1/owner/radios/:id/billing/checkout — démarre un abonnement Stripe
   (Checkout Session) pour un palier. Commercial : owner seul. Gated : 503 si
   STRIPE_SECRET absent ; 400 si le Price ID du palier n'est pas configuré. */
ownerRoutes.post("/radios/:id/billing/checkout", requireOwner, async (c) => {
  if (!isStripeBillingConfigured()) {
    return c.json({ error: { code: "stripe_disabled", message: "Stripe non configuré (STRIPE_SECRET absent)" } }, 503);
  }
  const body = billingCheckout.parse(await c.req.json());
  const [radio] = await db.select().from(radios).where(eq(radios.id, c.req.param("id"))).limit(1);
  if (!radio) throw notFound("Radio introuvable");
  if (!BILLABLE_TIERS.includes(body.tier) || !tierToPriceId(body.tier)) {
    throw badRequest(`Palier « ${body.tier} » non facturable ou Price ID Stripe manquant`, "invalid_tier");
  }
  try {
    const { url } = await createCheckoutSession(radio, body.tier, body.returnUrl);
    return c.json({ url });
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : "Échec Checkout Stripe", "stripe_checkout_error");
  }
});

const billingPortal = z.object({
  returnUrl: z.string().trim().min(1).max(500),
});

/* POST /v1/owner/radios/:id/billing/portal — Customer Portal (gérer CB/factures,
   annulation). Commercial : owner seul. Gated : 503 si STRIPE_SECRET absent. */
ownerRoutes.post("/radios/:id/billing/portal", requireOwner, async (c) => {
  if (!isStripeBillingConfigured()) {
    return c.json({ error: { code: "stripe_disabled", message: "Stripe non configuré (STRIPE_SECRET absent)" } }, 503);
  }
  const body = billingPortal.parse(await c.req.json());
  const [radio] = await db.select().from(radios).where(eq(radios.id, c.req.param("id"))).limit(1);
  if (!radio) throw notFound("Radio introuvable");
  try {
    const { url } = await createPortalSession(radio, body.returnUrl);
    return c.json({ url });
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : "Échec Portail Stripe", "stripe_portal_error");
  }
});

/* GET /v1/owner/registry — le parc sérialisé depuis la DB (source de vérité),
   avec l'abonnement joint. Sert de base au sync vers brand/clients.json
   (scripts/sync-registry.mjs) afin d'unifier les deux registres. Lecture : owner + it. */
ownerRoutes.get("/registry", requireItOrOwner, async (c) => {
  const rows = await db
    .select({
      id: radios.id,
      slug: radios.slug,
      name: radios.name,
      status: radios.status,
      plan: radios.plan,
      monthlyPrice: radios.monthlyPrice,
      licenseConfirmed: radios.licenseConfirmed,
      contactEmail: radios.contactEmail,
      domains: radios.domains,
      streamUrl: radios.streamUrl,
      subTier: subscriptions.planTier,
      subStatus: subscriptions.status,
      subPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(radios)
    .leftJoin(subscriptions, eq(subscriptions.radioId, radios.id))
    .orderBy(radios.createdAt);
  const clients = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    status: r.status,
    tier: r.plan,
    monthlyPrice: r.monthlyPrice,
    licenseConfirmed: r.licenseConfirmed,
    contactEmail: r.contactEmail,
    domains: r.domains,
    streamUrl: r.streamUrl,
    subscription:
      r.subTier != null
        ? { planTier: r.subTier, status: r.subStatus, currentPeriodEnd: r.subPeriodEnd }
        : null,
  }));
  return c.json({ generatedAt: new Date().toISOString(), clients });
});
