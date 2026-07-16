/* Résolution du tenant (radio courante) — approche « mur dans le code ».
   Chaque requête est rattachée à UNE radio, déduite ici, posée sur le contexte
   (c.get("radioId")) puis passée explicitement aux requêtes (filtrage radio_id).
   - Mono-radio (le parc n'a qu'une radio) → toujours elle ⇒ zéro drift.
   - Multi-radio → résolue par l'hôte HTTP (site public) ou le JWT/owner (admin). */

import { db } from "../db/client.js";
import { radios } from "../db/schema.js";
import { notFound } from "../lib/errors.js";

interface RadioLite {
  id: string;
  slug: string;
  domains: string[];
  status: string;
}

let CACHE: { rows: RadioLite[]; at: number } | null = null;
const TTL_MS = 30_000;

async function allRadios(): Promise<RadioLite[]> {
  const now = Date.now();
  if (CACHE && now - CACHE.at < TTL_MS) return CACHE.rows;
  const raw = await db
    .select({ id: radios.id, slug: radios.slug, domains: radios.domains, status: radios.status })
    .from(radios);
  const rows: RadioLite[] = raw.map((r) => ({
    id: r.id,
    slug: r.slug,
    domains: Array.isArray(r.domains) ? (r.domains as string[]) : [],
    status: r.status,
  }));
  CACHE = { rows, at: now };
  return rows;
}

/** Vide le cache (à appeler après création / modification d'une radio). */
export function invalidateRadioCache(): void {
  CACHE = null;
}

/** Test-only : injecte directement le cache des radios (évite toute DB en tests).
    Les middlewares publicTenant/adminTenant passent par allRadios() qui sert ce
    cache sans requêter. À n'utiliser que dans la suite tenant. */
export function setRadioCacheForTests(rows: { id: string; slug: string; domains: string[]; status: string }[]): void {
  CACHE = { rows, at: Date.now() };
}

function normHost(h: string): string {
  return h.toLowerCase().split(":")[0]!.replace(/^www\./, "");
}

/** Id de l'unique radio si le parc n'en compte qu'une, sinon null. */
export async function soleRadioId(): Promise<string | null> {
  const rows = await allRadios();
  return rows.length === 1 ? rows[0]!.id : null;
}

/** Résout la radio à partir de l'hôte HTTP (site public + beacons).
    Mono-radio → elle. Multi-radio sans correspondance → null. */
export async function radioIdForHost(host: string | undefined): Promise<string | null> {
  const rows = await allRadios();
  if (rows.length <= 1) return rows[0]?.id ?? null;
  const h = normHost(host ?? "");
  for (const r of rows) {
    if (r.domains.some((d) => normHost(d) === h)) return r.id;
  }
  return null;
}

/** Vérifie qu'un id de radio existe (pour la sélection côté owner). */
export async function radioExists(id: string): Promise<boolean> {
  const rows = await allRadios();
  return rows.some((r) => r.id === id);
}

/** Statut d'une radio (cache, 30 s). null si introuvable. Sert à l'enforcement
 *  lifecycle (bloquer public/admin si != active). */
export async function radioStatusFor(id: string): Promise<string | null> {
  const rows = await allRadios();
  return rows.find((r) => r.id === id)?.status ?? null;
}

/** Garantit une radio résolue : lève 404 si null (hôte inconnu en multi-radio).
    En mono-radio, jamais null ⇒ zéro impact. */
export function requireRadioId(radioId: string | null): string {
  if (!radioId) throw notFound("Radio introuvable pour cet hôte");
  return radioId;
}
