/* Chargeur des paliers tarifaires En Ondes (confidentiels).
 *
 * Les montants vivent dans _private/pricing-tiers.json (gitignoré) — ce module ne
 * contient AUCUN montant, il ne fait que lire/valider ce fichier pour les scripts
 * opérateur (add-to-registry, pre-go-live, gen-paperwork). Côté API, le mapping
 * palier -> Stripe Price ID passe par des variables d'env (STRIPE_PRICE_*_ID).
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const PRICING_FILE = join(root, "_private", "pricing-tiers.json");

let cached = null;

/** Charge et cache pricing-tiers.json. Throw si absent (le fichier est requis pour les scripts commerciaux). */
export async function loadPricing() {
  if (cached) return cached;
  const raw = await readFile(PRICING_FILE, "utf-8");
  cached = JSON.parse(raw);
  return cached;
}

/** Renvoie la liste ordonnée des slugs de paliers (starter, growth, pro, beyond). */
export async function tierSlugs() {
  const p = await loadPricing();
  return p.tierOrder || Object.keys(p.tiers || {});
}

/** Vrai si le slug est un palier connu. */
export async function isValidTier(slug) {
  const p = await loadPricing();
  return Boolean(p.tiers?.[slug]);
}

/** Renvoie la définition d'un palier (mrr, maxListeners, stripePriceId...). */
export async function getTier(slug) {
  const p = await loadPricing();
  return p.tiers?.[slug] ?? null;
}

/** MRR mensuel d'un palier (number), ou null si sur devis / inconnu. */
export async function tierMrr(slug) {
  const t = await getTier(slug);
  return t?.mrr ?? null;
}

/** Nom d'affichage lisible d'un palier. */
export function tierLabel(slug) {
  return { starter: "Starter", growth: "Growth", pro: "Pro", beyond: "Sur devis" }[slug] || slug;
}

/** Renvoie le Price ID Stripe d'un palier : depuis l'env (prioritaire) sinon le JSON. */
export async function tierStripePriceId(slug) {
  const t = await getTier(slug);
  if (!t) return null;
  const fromEnv = t.stripePriceIdEnv ? process.env[t.stripePriceIdEnv] : null;
  return fromEnv || t.stripePriceId || null;
}

export { PRICING_FILE };
