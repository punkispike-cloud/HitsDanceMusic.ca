/* En Ondes — Ajoute (ou met à jour) un client dans le registre ops brand/clients.json.
 *
 Étape d'onboarding commerciale (avant ou juste après la création du tenant en DB) :
 *   on consigne les infos commerciales/ops du client (slug, nom, forfait, contact,
 *   branch, railwayProject, domaines) au registre privé. Les champs DB-backed
 *   (status/tier/licences/billing) seront rafraîchir par `npm run sync-registry`
 *   une fois la radio en base ; ce script pose les champs ops-only que la DB ne
 *   porte pas. Préserve les entrées existantes (merge par slug).
 *
 Usage :
 *   node scripts/add-to-registry.mjs --slug rockradio --name "Rockfort" \
 *     --tier starter --contact-email gestion@rockfort.ca \
 *     --branch client/rockradio --railway-project "Rockfort" \
 *     --site-domain rockfort.ca --api-domain api.rockfort.ca --admin-domain admin.rockfort.ca
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const key = a.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) {
    args[key] = next;
    i++;
  } else {
    args[key] = "true";
  }
}

const slug = (args.slug || "").trim().toLowerCase();
if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
  console.error("[add-to-registry] --slug requis (minuscules/chiffres/tirets, 2-40).");
  process.exit(2);
}

async function loadRegistry() {
  for (const f of ["clients.json", "clients.example.json"]) {
    try {
      const raw = await readFile(join(root, "brand", f), "utf-8");
      return JSON.parse(raw);
    } catch {
      /* essaie le suivant */
    }
  }
  return { clients: [] };
}

const parsed = await loadRegistry();
const clients = Array.isArray(parsed.clients) ? parsed.clients : [];
const existing = clients.find((c) => c.slug === slug) || {};

const domains = {
  site: args["site-domain"] || existing.domains?.site || "",
  api: args["api-domain"] || existing.domains?.api || "",
  admin: args["admin-domain"] || existing.domains?.admin || "",
};

const entry = {
  ...existing,
  slug,
  name: args.name || existing.name || slug,
  status: args.status || existing.status || "provisioning",
  role: existing.role || undefined,
  branch: args.branch || existing.branch || undefined,
  railwayProject: args["railway-project"] || existing.railwayProject || "(à créer)",
  tier: args.tier || existing.tier || null,
  domains,
  contact: { ...(existing.contact || {}), email: args["contact-email"] || existing.contact?.email || "" },
  licenses: existing.licenses || { attested: false, socan: false, resonne: false, note: "" },
  billing: existing.billing || { mrr: null, status: "none", nextInvoice: null },
  commissioned: existing.commissioned || new Date().toISOString().slice(0, 10),
};
// Nettoie les clés undefined pour garder un JSON propre.
for (const k of Object.keys(entry)) if (entry[k] === undefined) delete entry[k];

const idx = clients.findIndex((c) => c.slug === slug);
if (idx >= 0) clients[idx] = entry;
else clients.push(entry);

const out = {
  _comment:
    parsed._comment ??
    "Registre des clients En Ondes (sync-registry : radios DB = source de vérité ; champs ops-only préservés).",
  clients,
};
const target = join(root, "brand", "clients.json");
await writeFile(target, JSON.stringify(out, null, 2) + "\n", "utf-8");
console.log(`[add-to-registry] ✓ ${idx >= 0 ? "mis à jour" : "ajouté"} : ${slug} (${entry.name}) → ${target}`);
