/* Autologix — Statut de tous les clients (gestion centralisée).
 * Lit brand/clients.json et ping le /health de chaque client actif → tableau
 * up/down + DB + temps de réponse. La vue « santé de tout mon parc » en 1 commande.
 *
 * Usage :
 *   node scripts/status.mjs
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

let registry;
try {
  registry = JSON.parse(await readFile(join(root, "brand", "clients.json"), "utf-8"));
} catch {
  console.error("✗ brand/clients.json introuvable ou invalide.");
  process.exit(1);
}

const clients = (registry.clients || []).filter((c) => c.status === "active" && c.domains?.api);
if (!clients.length) {
  console.log("Aucun client actif avec une API dans le registre.");
  process.exit(0);
}

const TIMEOUT = 12_000;
async function pingHealth(api) {
  const url = `${api.replace(/\/$/, "")}/health`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
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

console.log(`\n📡 Statut du parc Autologix — ${new Date().toLocaleString("fr-CA")}\n`);
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
