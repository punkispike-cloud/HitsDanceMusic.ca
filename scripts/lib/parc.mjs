/* Module partagé du parc Autologix : lecture du registre clients + ping santé +
 * agrégation. Réutilisé par scripts/status.mjs (CLI) et scripts/console.mjs
 * (cockpit web local) → une seule source de vérité pour « l'état du parc ».
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/lib/parc.mjs → remonter de 3 niveaux jusqu'à la racine du dépôt.
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const HEALTH_TIMEOUT = 12_000;

/** Charge le registre : brand/clients.json, repli sur clients.example.json. */
export async function loadRegistry() {
  for (const f of ["clients.json", "clients.example.json"]) {
    try {
      return JSON.parse(await readFile(join(root, "brand", f), "utf-8"));
    } catch {
      /* essaie le suivant */
    }
  }
  throw new Error("Aucun registre (brand/clients.json ni clients.example.json).");
}

/** Ping le /health d'une API → { up, db, ms }. Jamais throw (renvoie down). */
export async function pingHealth(api) {
  const url = `${api.replace(/\/$/, "")}/health`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT);
  const started = Date.now();
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const ms = Date.now() - started;
    let json = null;
    try { json = JSON.parse(await r.text()); } catch { /* non-JSON */ }
    return { up: r.status === 200 && json?.ok === true, db: json?.db === true, ms };
  } catch {
    return { up: false, db: false, ms: Date.now() - started };
  } finally {
    clearTimeout(t);
  }
}

/** Une radio est « pingable » si elle est active et a une API. */
export function isPingable(c) {
  return c.status === "active" && Boolean(c.domains?.api);
}

/**
 * Vue agrégée du parc : chaque client + sa santé (null si non pingé) + KPIs.
 * Les radios provisioning/paused sont listées mais NON pinguées.
 */
export async function buildParc() {
  const registry = await loadRegistry();
  const all = registry.clients || [];

  const clients = await Promise.all(
    all.map(async (c) => ({
      ...c,
      health: isPingable(c) ? await pingHealth(c.domains.api) : null,
    })),
  );

  const pingable = clients.filter(isPingable);
  const up = pingable.filter((c) => c.health?.up).length;
  const down = pingable.length - up;
  const licencesAConfirmer = clients.filter((c) => !c.licenses?.attested).length;

  // Revenu mensuel : seulement si au moins un client porte un montant numérique
  // (renseigné dans le vrai clients.json privé). Sinon null → masqué côté UI.
  const mrrValues = clients
    .map((c) => c.billing?.mrr)
    .filter((v) => typeof v === "number");
  const mrr = mrrValues.length ? mrrValues.reduce((a, b) => a + b, 0) : null;

  return {
    generatedAt: new Date().toISOString(),
    clients,
    kpis: {
      total: clients.length,
      active: pingable.length,
      up,
      down,
      licencesAConfirmer,
      mrr,
    },
  };
}
