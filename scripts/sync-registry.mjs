/* En Ondes — Synchronise le registre ops (brand/clients.json) depuis la DB.
 *
 La table `radios` devient la source de vérité du parc. Ce script lit les radios +
 abonnements (cf. GET /v1/owner/registry) et MERGE brand/clients.json :
 *  - champs DB-backed mis à jour : status, tier (← plan), licenses.attested
 *    (← licenseConfirmed), billing.mrr (← monthlyPrice), billing.status (← abonnement).
 *  - champs ops-only PRÉSERVÉS (la DB ne les porte pas) : role, branch,
 *    railwayProject, domains {site,api,admin}, listing, commissioned,
 *    licenses.socan/resonne/note, billing.nextInvoice.
 *  - radios présentes en DB mais absentes du registre : ajout d'un stub à compléter.
 *  - entrées du registre absentes de la DB : conservées (clients instance-dédiée).
 *
 Env-driven (process.env.DATABASE_URL) — pattern create-superadmin/test-rls.
 Lancer :  DATABASE_URL="postgres://..." node scripts/sync-registry.mjs [--dry-run]
 Le vrai brand/clients.json est privé/gitignored ; on ne l'écrase que sur --dry-run
 absent (sinon affiche seulement le diff). */

import pg from "pg";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dryRun = process.argv.includes("--dry-run");

if (!process.env.DATABASE_URL) {
  console.error("[sync-registry] DATABASE_URL requis.");
  process.exit(2);
}

const ssl = /railway|amazonaws|proxy\.rlwy/i.test(process.env.DATABASE_URL)
  ? { rejectUnauthorized: false }
  : undefined;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl });

/** Charge le registre existant (clients.json privé, repli sur l'exemple public). */
async function loadRegistry() {
  for (const f of ["clients.json", "clients.example.json"]) {
    try {
      const raw = await readFile(join(root, "brand", f), "utf-8");
      return { parsed: JSON.parse(raw), from: f };
    } catch {
      /* essaie le suivant */
    }
  }
  return { parsed: { clients: [] }, from: null };
}

try {
  // Vue DB (miroir de GET /v1/owner/registry).
  const { rows } = await pool.query(
    `SELECT r.id, r.slug, r.name, r.status, r.plan, r.monthly_price, r.license_confirmed,
            r.contact_email, r.domains, r.stream_url,
            s.plan_tier AS sub_tier, s.status AS sub_status, s.current_period_end AS sub_period_end
       FROM radios r
       LEFT JOIN subscriptions s ON s.radio_id = r.id
       ORDER BY r.created_at`,
  );

  const { parsed, from } = await loadRegistry();
  const clients = Array.isArray(parsed.clients) ? parsed.clients : [];
  const bySlug = new Map(clients.map((c) => [c.slug, c]));
  const dbSlugs = new Set(rows.map((r) => r.slug));

  let updated = 0;
  let added = 0;

  for (const r of rows) {
    const existing = bySlug.get(r.slug);
    if (existing) {
      // Merge : DB-backed gagne, ops-only préservé.
      existing.name = r.name ?? existing.name;
      existing.status = r.status ?? existing.status;
      existing.tier = r.plan ?? existing.tier ?? existing.tier;
      if (!existing.licenses) existing.licenses = {};
      existing.licenses.attested = Boolean(r.license_confirmed);
      if (!existing.billing) existing.billing = {};
      if (typeof r.monthly_price === "number") existing.billing.mrr = r.monthly_price;
      if (r.sub_status) existing.billing.status = r.sub_status;
      existing._dbId = r.id; // ancre ops (peut être retiré)
      updated++;
    } else {
      // Stub : radio en DB non encore dans le registre ops.
      bySlug.set(r.slug, {
        slug: r.slug,
        name: r.name,
        status: r.status,
        tier: r.plan ?? null,
        domains: { site: "", api: "", admin: "" },
        licenses: {
          attested: Boolean(r.license_confirmed),
          socan: false,
          resonne: false,
          note: "Ajouté par sync-registry — à compléter.",
        },
        billing: {
          mrr: typeof r.monthly_price === "number" ? r.monthly_price : null,
          status: r.sub_status ?? "none",
          nextInvoice: null,
        },
        commissioned: null,
        _syncNote: "Ajouté par sync-registry — compléter role/branch/railwayProject/domains.",
      });
      added++;
    }
  }

  const orphaned = clients.filter((c) => !dbSlugs.has(c.slug)).map((c) => c.slug);
  const out = {
    _comment: parsed._comment ?? "Registre des clients En Ondes (sync-registry : radios DB = source de vérité ; champs ops-only préservés).",
    clients: [...bySlug.values()],
  };

  const target = join(root, "brand", "clients.json");
  console.log(`[sync-registry] source registre : ${from ?? "(aucune — créé)"}`);
  console.log(`[sync-registry] radios en DB : ${rows.length} · mis à jour : ${updated} · ajoutés (stub) : ${added}`);
  if (orphaned.length) console.log(`[sync-registry] entrées registre sans radio en DB (conservées) : ${orphaned.join(", ")}`);

  if (dryRun) {
    console.log("\n[sync-registry] --dry-run : aperçu du résultat (non écrit).\n");
    console.log(JSON.stringify(out, null, 2));
  } else {
    await writeFile(target, JSON.stringify(out, null, 2) + "\n", "utf-8");
    console.log(`[sync-registry] ✓ écrit : ${target}`);
  }
} catch (err) {
  console.error("[sync-registry] échec :", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
