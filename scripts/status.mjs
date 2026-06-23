/* En Ondes — Statut de tous les clients (gestion centralisée).
 * Lit brand/clients.json et ping le /health de chaque client actif → tableau
 * up/down + DB + temps de réponse. La vue « santé de tout mon parc » en 1 commande.
 *
 * Vue VISUELLE équivalente : `node scripts/console.mjs` (cockpit web local).
 *
 * Usage :
 *   node scripts/status.mjs
 */

import { loadRegistry, pingHealth, isPingable } from "./lib/parc.mjs";

const registry = await loadRegistry().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});

const clients = (registry.clients || []).filter(isPingable);
if (!clients.length) {
  console.log("Aucun client actif avec une API dans le registre.");
  process.exit(0);
}

console.log(`\n📡 Statut du parc En Ondes — ${new Date().toLocaleString("fr-CA")}\n`);
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(`  ${pad("Radio", 22)} ${pad("État", 8)} ${pad("DB", 6)} ${pad("Temps", 8)} Licences`);
console.log(`  ${"-".repeat(60)}`);

let down = 0;
for (const c of clients) {
  const h = await pingHealth(c.domains.api);
  if (!h.up) down++;
  const etat = h.up ? "🟢 UP" : "🔴 DOWN";
  const db = h.up ? (h.db ? "ok" : "✗") : "—";
  const lic = c.licenses?.attested ? "✅" : "⚠️ à confirmer";
  console.log(`  ${pad(c.name, 22)} ${pad(etat, 8)} ${pad(db, 6)} ${pad(h.ms + "ms", 8)} ${lic}`);
}

console.log(
  down === 0
    ? `\n✅ ${clients.length} client(s), tous en ligne.\n`
    : `\n🔴 ${down}/${clients.length} client(s) DOWN — à investiguer.\n`,
);
process.exit(down === 0 ? 0 : 1);
