/* Autologix — Mises à jour mutualisées (guide généré).
 * Le code est partagé : un correctif sur `main` doit être propagé à chaque client
 * (chacun a sa branche + son projet Railway). Ce script ne touche À RIEN : il
 * IMPRIME les commandes exactes à lancer par client, depuis le registre.
 *
 * Usage :
 *   node scripts/update-clients.mjs
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
async function loadRegistry() {
  for (const f of ["clients.json", "clients.example.json"]) {
    try { return JSON.parse(await readFile(join(root, "brand", f), "utf-8")); } catch { /* suivant */ }
  }
  console.error("✗ Aucun registre client.");
  process.exit(1);
}
const registry = await loadRegistry();
const clients = (registry.clients || []).filter((c) => c.status === "active");

console.log(`\n🔄 Propagation d'une mise à jour plateforme à ${clients.length} client(s)\n`);
console.log("Pré-requis : le correctif est mergé/poussé sur `main`, CI verte.\n");

for (const c of clients) {
  console.log(`\n──────── ${c.name}  (branche: ${c.branch || "?"}, projet: ${c.railwayProject || "?"}) ────────`);
  if ((c.branch || "main") === "main") {
    console.log("  • Ce client EST la baseline `main` → déjà à jour au push sur main.");
  } else {
    console.log(`  git checkout ${c.branch} && git merge main --no-edit`);
    console.log(`  BRAND=${c.slug} node scripts/build-all.mjs`);
    console.log(`  git commit -am "chore: maj plateforme" && git push   # Railway redéploie`);
  }
  if (c.domains?.api) console.log(`  node scripts/verify-deploy.mjs ${c.domains.api}`);
}

console.log("\nAprès propagation : `node scripts/status.mjs` pour confirmer tout le parc 🟢.\n");
