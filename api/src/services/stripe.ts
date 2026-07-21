/* Service Stripe — facturation récurrente (Phase 5).
 *
 * Portée : création client + Checkout Session (démarrer un abonnement), Customer
 * Portal (gérer CB/factures), et synchronisation des abonnements depuis les webhooks.
 *
 * Gating : inactif tant que STRIPE_SECRET / STRIPE_WEBHOOK_SECRET ne sont pas posés.
 * Le SDK `stripe` est chargé paresseusement (dynamic import) afin que le reste de
 * l'API n'ait pas besoin de la dépendance au démarrage et que les fonctions de
 * mapping palier <-> Price ID restent testables sans SDK.
 *
 * Source unique des paliers : _private/pricing-tiers.json (montants, confidentiels).
 * Côté API, on ne connaît que les Price IDs (variables d'env STRIPE_PRICE_*_ID). */

import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { radios, subscriptions, stripeEvents, type RadioStatus } from "../db/schema.js";
import { env, isStripeBillingConfigured } from "../env.js";
import { invalidateRadioCache } from "./tenant.js";
import type Stripe from "stripe";

type SubStatus = (typeof subscriptions.status.enumValues)[number];

/** Palier -> variable d'env contenant le Price ID Stripe. */
const TIER_PRICE_ENV: Record<string, string> = {
  starter: "STRIPE_PRICE_STARTER_ID",
  growth: "STRIPE_PRICE_GROWTH_ID",
  pro: "STRIPE_PRICE_PRO_ID",
};

export const BILLABLE_TIERS = Object.keys(TIER_PRICE_ENV);

/** Price ID Stripe d'un palier (depuis l'env), ou null si non configuré. */
export function tierToPriceId(tier: string): string | null {
  const envName = TIER_PRICE_ENV[tier];
  if (!envName) return null;
  const v = process.env[envName];
  return v && v.trim() !== "" ? v.trim() : null;
}

/** Palier correspondant à un Price ID (balayage des vars d'env), ou null. */
export function priceIdToTier(priceId: string | undefined | null): string | null {
  if (!priceId) return null;
  for (const [tier, envName] of Object.entries(TIER_PRICE_ENV)) {
    const v = process.env[envName];
    if (v && v.trim() === priceId.trim()) return tier;
  }
  return null;
}

let stripeClient: Stripe | null | undefined;

/** Client Stripe singleton (chargé paresseusement). Null si STRIPE_SECRET absent. */
export async function getStripe(): Promise<Stripe | null> {
  if (stripeClient !== undefined) return stripeClient;
  if (!isStripeBillingConfigured()) {
    stripeClient = null;
    return null;
  }
  const { default: Stripe } = await import("stripe");
  stripeClient = new Stripe(env.STRIPE_SECRET, {
    appInfo: { name: "en-ondes-api", version: "1.0.0" },
  });
  return stripeClient;
}

/** Map un statut d'abonnement Stripe vers notre enum `subscription_status`. */
export function mapStripeStatus(status: string | undefined): SubStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "incomplete":
      return "incomplete";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "incomplete";
  }
}

/** Statut radio déduit d'un abonnement : mauvais statut -> paused, bon statut -> active
 *  (seulement si actuellement paused, pour ne pas forcer un provisioning en active). */
function cascadeRadioStatus(sub: SubStatus): RadioStatus | null {
  if (sub === "canceled" || sub === "past_due") return "paused";
  if (sub === "active" || sub === "trialing") return "active";
  return null; // ne pas toucher (incomplete)
}

/** Crée ou réutilise un Customer Stripe pour la radio, et persiste l'id client. */
async function ensureCustomer(radio: typeof radios.$inferSelect): Promise<string> {
  const stripe = await getStripe();
  if (!stripe) throw new Error("Stripe non configuré (STRIPE_SECRET absent).");

  const [row] = await db
    .select({ id: subscriptions.id, customerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.radioId, radio.id))
    .limit(1);
  if (row?.customerId) return row.customerId;

  const customer = await stripe.customers.create({
    name: radio.name,
    email: radio.contactEmail ?? undefined,
    metadata: { radio_id: radio.id, slug: radio.slug },
  });

  // Upsert d'une ligne abonnement (draft) portant le customer id.
  await db
    .insert(subscriptions)
    .values({
      radioId: radio.id,
      stripeCustomerId: customer.id,
      planTier: radio.plan ?? "starter",
      status: "incomplete",
    })
    .onConflictDoUpdate({
      target: subscriptions.radioId,
      set: { stripeCustomerId: customer.id, updatedAt: new Date() },
    });
  return customer.id;
}

/** Crée une Checkout Session pour démarrer l'abonnement d'un palier. */
export async function createCheckoutSession(
  radio: typeof radios.$inferSelect,
  tier: string,
  returnUrl: string,
): Promise<{ url: string }> {
  const stripe = await getStripe();
  if (!stripe) throw new Error("Stripe non configuré (STRIPE_SECRET absent).");
  const priceId = tierToPriceId(tier);
  if (!priceId) throw new Error(`Aucun Price ID Stripe pour le palier « ${tier} » (var ${TIER_PRICE_ENV[tier]} absente).`);

  const customerId = await ensureCustomer(radio);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: radio.id,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { metadata: { radio_id: radio.id, plan_tier: tier } },
    success_url: returnUrl,
    cancel_url: returnUrl,
  });
  if (!session.url) throw new Error("Stripe n'a pas renvoyé d'URL de Checkout.");
  return { url: session.url };
}

/** Crée une session du Customer Portal (gérer CB / factures / annulation). */
export async function createPortalSession(
  radio: typeof radios.$inferSelect,
  returnUrl: string,
): Promise<{ url: string }> {
  const stripe = await getStripe();
  if (!stripe) throw new Error("Stripe non configuré (STRIPE_SECRET absent).");

  const [row] = await db
    .select({ customerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.radioId, radio.id))
    .limit(1);
  if (!row?.customerId) throw new Error("Aucun client Stripe rattaché à cette radio.");

  const session = await stripe.billingPortal.sessions.create({
    customer: row.customerId,
    return_url: returnUrl,
  });
  return { url: session.url };
}

/** Upsert d'une ligne `subscriptions` depuis un objet Subscription Stripe, + cascade
 *  du statut radio. `eventCreatedAt` = horodatage de l'événement Stripe (event.created)
 *  pour la garde anti-désordre. Renvoie la radio_id concernée (ou null si orphelin). */
export async function syncSubscriptionFromStripe(
  sub: Stripe.Subscription,
  eventCreatedAt: Date,
): Promise<string | null> {
  const radioId = (sub.metadata?.radio_id as string | undefined) || null;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  const tier = (sub.metadata?.plan_tier as string | undefined) || priceIdToTier(sub.items?.data?.[0]?.price?.id);
  const status = mapStripeStatus(sub.status);
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;

  // Résolution de la radio. Priorité à la ligne qui possède DÉJÀ ce subscription id :
  // elle est autoritative (un abonnement Stripe appartient à exactement une radio), ce
  // qui évite une violation d'unicité sur stripe_subscription_id si metadata.radio_id
  // diverge d'une ligne existante. Sinon metadata, sinon la ligne du customer.
  const [bySub] = await db
    .select({ radioId: subscriptions.radioId, lastEventAt: subscriptions.lastEventAt })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, sub.id))
    .limit(1);
  let resolvedRadioId = bySub?.radioId ?? radioId;
  if (!resolvedRadioId && customerId) {
    const [byCust] = await db
      .select({ radioId: subscriptions.radioId })
      .from(subscriptions)
      .where(eq(subscriptions.stripeCustomerId, customerId))
      .limit(1);
    resolvedRadioId = byCust?.radioId ?? null;
  }
  if (!resolvedRadioId) return null; // événement orphelin (aucune radio connue)

  // Garde anti-désordre : Stripe ne garantit pas l'ordre de livraison. Si un événement
  // plus RÉCENT a déjà été appliqué, on ignore ce (plus ancien) pour ne pas ré-écraser
  // le statut (ex. un `updated` actif retardé ne doit pas ré-activer une radio annulée).
  const [current] = await db
    .select({ lastEventAt: subscriptions.lastEventAt })
    .from(subscriptions)
    .where(eq(subscriptions.radioId, resolvedRadioId))
    .limit(1);
  if (current?.lastEventAt && eventCreatedAt.getTime() < current.lastEventAt.getTime()) {
    return resolvedRadioId; // événement périmé → ne rien changer
  }

  await db
    .insert(subscriptions)
    .values({
      radioId: resolvedRadioId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      planTier: tier ?? "starter",
      status,
      currentPeriodEnd: periodEnd,
      lastEventAt: eventCreatedAt,
    })
    .onConflictDoUpdate({
      target: subscriptions.radioId,
      set: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        planTier: tier ?? undefined,
        status,
        currentPeriodEnd: periodEnd,
        lastEventAt: eventCreatedAt,
        updatedAt: new Date(),
      },
    });

  const cascade = cascadeRadioStatus(status);
  if (cascade === "paused") {
    await db.update(radios).set({ status: "paused", updatedAt: new Date() }).where(eq(radios.id, resolvedRadioId));
    invalidateRadioCache(); // l'enforcement lifecycle (middleware) s'applique aussitôt
  } else if (cascade === "active") {
    // Ne réactiver que si la radio est actuellement suspendue (pas un provisioning).
    await db
      .update(radios)
      .set({ status: "active", updatedAt: new Date() })
      .where(sql`${radios.id} = ${resolvedRadioId} and ${radios.status} = 'paused'`);
    invalidateRadioCache();
  }
  return resolvedRadioId;
}

/* ───────────────────────── Webhook ───────────────────────── */

/** Vérifie la signature d'un événement Stripe. Nécessite STRIPE_WEBHOOK_SECRET ;
 *  la clé API n'est pas utilisée pour la vérif crypto (un instance « webhook-only »
 *  suffit si STRIPE_SECRET est absent). Lève si la signature est invalide. */
export async function constructWebhookEvent(rawBody: string, signature: string): Promise<Stripe.Event> {
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(env.STRIPE_SECRET || "webhook_only", {
    appInfo: { name: "en-ondes-api", version: "1.0.0" },
  });
  return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

/** Enregistre un event.id comme « en cours de traitement ». Renvoie false si l'event
 *  a déjà été traité (redelivery) → l'appelant doit l'ignorer. Sert de verrou
 *  d'idempotence partagé (ON CONFLICT DO NOTHING). */
async function claimStripeEvent(event: Stripe.Event): Promise<boolean> {
  const rows = await db
    .insert(stripeEvents)
    .values({
      eventId: event.id,
      type: event.type,
      eventCreatedAt: event.created ? new Date(event.created * 1000) : null,
    })
    .onConflictDoNothing({ target: stripeEvents.eventId })
    .returning({ id: stripeEvents.eventId });
  return rows.length > 0;
}

/** Dispatch un événement Stripe vérifié. La synchro des abonnements passe par les
 *  événements customer.subscription.* (ils portent l'objet Subscription complet).
 *  Les invoice.* sont ignorés (informationnels).
 *  Idempotent : un event.id déjà traité est ignoré. En cas d'échec du traitement,
 *  la réservation est retirée pour laisser Stripe réessayer (le webhook renvoie 500). */
export async function handleStripeEvent(event: Stripe.Event): Promise<string | null> {
  const fresh = await claimStripeEvent(event);
  if (!fresh) return null; // déjà traité → no-op

  const eventCreatedAt = event.created ? new Date(event.created * 1000) : new Date();
  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        return await syncSubscriptionFromStripe(event.data.object as Stripe.Subscription, eventCreatedAt);
      default:
        return null; // événement non traité
    }
  } catch (err) {
    // Échec : on annule la réservation pour que la redelivery Stripe soit re-traitée.
    await db.delete(stripeEvents).where(eq(stripeEvents.eventId, event.id)).catch(() => {});
    throw err;
  }
}
