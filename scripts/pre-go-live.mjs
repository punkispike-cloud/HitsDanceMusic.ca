/* En Ondes — Checklist de mise en ondes (pre-go-live) pour un client.
 *
 Vérifie (best-effort) qu'un client est prêt à go live :
 *   1. Registre ops   : brand/clients.json contient le slug.
 *   2. Marque          : brand/<slug>.json sans CHANGEME / À_REMPLIR.
 *   3. Paperasse       : _private/clients/<slug>/ a contrat + attestation.
 *   4. DB — radio      : existe, status=active, licences confirmées (DATABASE_URL).
 *   5. DB — superadmin : un compte superadmin rattache à la radio.
 *   6. DB — abonnement : une ligne subscriptions existe pour la radio.
 *   7. API santé       : GET <api>/health → ok (depuis clients.json domains.api ou --api-url).
 *   8. DNS             : le domaine site résout (dns.lookup).
 *
 Chaque check : ✓ ok / ✗ fail (bloquant) / ⚠ warn (non bloquant). Exit 0 si aucun
 fail, 1 sinon. Les checks DB/API/DNS sont skippés (warn) si la config manque.
 *
 Usage :
 *   DATABASE_URL="postgres://..." node scripts/pre-go-live.mjs --slug rockradio
 *   ... --api-url https://api.rockfort.ca   # forcer l'URL API
 */

import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { lookup as dnsLookup } from "node:dns/promises";
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
if (!slug) {
  console.error("[pre-go-live] --slug requis.");
  process.exit(2);
}

let clientEntry = null;
let apiUrl = args["api-url"] || "";
try {
  const reg = JSON.parse(await readFile(join(root, "brand", "clients.json"), "utf-8"));
  clientEntry = (reg.clients || []).find((c) => c.slug === slug) || null;
  if (!apiUrl && clientEntry?.domains?.api) apiUrl = clientEntry.domains.api;
} catch {
  /* registre privé absent */
}

const checks = [];
const fail = (label, detail) => checks.push({ label, status: "fail", detail });
const ok = (label, detail) => checks.push({ label, status: "ok", detail });
const warn = (label, detail) => checks.push({ label, status: "warn", detail });

// 1. Registre ops
if (clientEntry) ok("Registre ops (clients.json)", `statut=${clientEntry.status}, tier=${clientEntry.tier || "—"}`);
else fail("Registre ops (clients.json)", "slug absent — lancer `npm run add-to-registry -- --slug " + slug + " …`");

// 2. Marque
try {
  const brand = await readFile(join(root, "brand", `${slug}.json`), "utf-8");
  const leftovers = [...brand.matchAll(/CHANGEME|À_REMPLIR/g)];
  if (leftovers.length) fail("Marque (brand/<slug>.json)", `${leftovers.length} champ(s) CHANGEME/À_REMPLIR restants`);
  else ok("Marque (brand/<slug>.json)", "aucun champ à compléter");
} catch {
  fail("Marque (brand/<slug>.json)", "fichier absent — lancer `node scripts/new-client.mjs " + slug + " \"Nom\"`");
}

// 3. Paperasse
try {
  const files = await readdir(join(root, "_private", "clients", slug));
  const hasContrat = files.some((f) => /^CONTRAT-/.test(f));
  const hasAtt = files.some((f) => /^ATTESTATION-/.test(f));
  if (hasContrat && hasAtt) ok("Paperasse (_private/clients/<slug>)", "contrat + attestation présents");
  else fail("Paperasse (_private/clients/<slug>)", `manquant(s) : ${!hasContrat ? "contrat " : ""}${!hasAtt ? "attestation" : ""} — lancer gen-paperwork`);
} catch {
  warn("Paperasse (_private/clients/<slug>)", "dossier absent — lancer `node scripts/gen-paperwork.mjs --slug " + slug + " --legal-name …`");
}

// 4-6. DB
const dbUrl = process.env.DATABASE_URL;
let pool = null;
if (dbUrl) {
  const ssl = /railway|amazonaws|proxy\.rlwy/i.test(dbUrl) ? { rejectUnauthorized: false } : undefined;
  pool = new pg.Pool({ connectionString: dbUrl, ssl });
  try {
    const { rows } = await pool.query("SELECT id, name, status, license_confirmed FROM radios WHERE slug=$1 LIMIT 1", [slug]);
    const radio = rows[0];
    if (!radio) fail("DB — radio", "radio absente — créer via POST /v1/owner/radios ou l'admin /parc");
    else {
      if (radio.status === "active") ok("DB — radio active", `id=${radio.id}`);
      else fail("DB — radio active", `status=${radio.status} (activer via /parc ou provision.mjs)`);
      if (radio.license_confirmed) ok("DB — licences confirmées", "license_confirmed=true");
      else warn("DB — licences confirmées", "license_confirmed=false — à confirmer avant exploitation");
      // 5. superadmin
      if (radio) {
        const u = await pool.query("SELECT id, email FROM users WHERE radio_id=$1 AND role='superadmin' AND is_active LIMIT 1", [radio.id]);
        if (u.rows[0]) ok("DB — superadmin", u.rows[0].email);
        else fail("DB — superadmin", "aucun superadmin actif pour cette radio");
      }
      // 6. abonnement
      if (radio) {
        const s = await pool.query("SELECT plan_tier, status FROM subscriptions WHERE radio_id=$1 LIMIT 1", [radio.id]);
        if (s.rows[0]) ok("DB — abonnement", `${s.rows[0].plan_tier} (${s.rows[0].status})`);
        else warn("DB — abonnement", "aucune ligne subscriptions (trial ou checkout à faire)");
      }
    }
  } catch (err) {
    fail("DB — requêtes", err instanceof Error ? err.message : String(err));
  }
} else {
  warn("DB — radio/superadmin/abonnement", "DATABASE_URL absent — checks DB ignorés");
}

// 7. API santé
if (apiUrl) {
  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) ok("API santé", `${apiUrl}/health → ${res.status}`);
    else fail("API santé", `${apiUrl}/health → HTTP ${res.status}`);
  } catch (err) {
    fail("API santé", `${apiUrl}/health injoignable — ${err instanceof Error ? err.message : err}`);
  }
} else {
  warn("API santé", "URL API absente (--api-url ou clients.json domains.api)");
}

// 8. DNS
const siteDomain = (clientEntry?.domains?.site || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
if (siteDomain) {
  try {
    await dnsLookup(siteDomain);
    ok("DNS (site)", `${siteDomain} résout`);
  } catch (err) {
    fail("DNS (site)", `${siteDomain} ne résout pas — ${err instanceof Error ? err.message : err}`);
  }
} else {
  warn("DNS (site)", "domaine site absent dans clients.json");
}

if (pool) await pool.end().catch(() => {});

// Rapport
console.log(`\n[pre-go-live] ${slug}`);
for (const c of checks) {
  const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "⚠" : "✗";
  console.log(`  ${icon} ${c.label.padEnd(28)} ${c.detail ?? ""}`);
}
const fails = checks.filter((c) => c.status === "fail").length;
const warns = checks.filter((c) => c.status === "warn").length;
console.log(
  `\n[pre-go-live] ${fails ? `❌ ${fails} bloquant(s)` : "✅ prête à go live"}${warns ? ` · ${warns} avertissement(s)` : ""}`,
);
process.exit(fails ? 1 : 0);
