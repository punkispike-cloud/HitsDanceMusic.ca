/* En Ondes — Orchestrateur de provisioning d'un client (Phase 5/A3).
 *
 Prérequis : la radio a été créée via POST /v1/owner/radios (admin /parc ou curl) —
 le tenant + son superadmin + l'abonnement trialing existent en DB (status=
 provisioning). Ce script orchestre la mise en ondes :
 *   1. build-all        : (ré)génère le site statique (BRAND=<slug> npm run build).
 *   2. Railway          : déploiement du service — best-effort via CLI `railway`
 *                         si RAILWAY_TOKEN présent, sinon étapes manuelles imprimées.
 *   3. DNS (Cloudflare) : crée les CNAME site/api/admin vers les domaines Railway
 *                         générés — réel si CLOUDFLARE_API_TOKEN + ZONE_ID + cibles
 *                         fournis, sinon étapes manuelles.
 *   4. activation       : UPDATE radios SET status='active' (provisioning -> active).
 *
 Chaque étape est GATED : absente de config → imprimée comme étape manuelle, sans
 faire échouer le script. L'activation (étape 4) ne s'applique QUE si --skip-activate
 n'est pas posé. --activate-only saute 1/2/3 (utile quand l'infra est déjà en place).
 *
 Usage :
 *   DATABASE_URL="postgres://..." node scripts/provision.mjs \
 *     --slug rockradio \
 *     --site-target "rockradio-web.up.railway.app" \
 *     --api-target  "rockradio-api.up.railway.app" \
 *     --admin-target "rockradio-admin.up.railway.app"
 */

import pg from "pg";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ─── Args ─────────────────────────────────────────────────────────────────────
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

const slug = (args.slug || "").trim();
const skipBuild = "skip-build" in args;
const skipDns = "skip-dns" in args;
const skipRailway = "skip-railway" in args;
const skipActivate = "skip-activate" in args;
const activateOnly = "activate-only" in args;
const siteTarget = args["site-target"] || "";
const apiTarget = args["api-target"] || "";
const adminTarget = args["admin-target"] || "";

if (!slug) {
  console.error("[provision] --slug requis.");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("[provision] DATABASE_URL requis (lire/activer la radio).");
  process.exit(2);
}

const ssl = /railway|amazonaws|proxy\.rlwy/i.test(process.env.DATABASE_URL)
  ? { rejectUnauthorized: false }
  : undefined;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl });

const checklist = [];
const note = (step, status, detail = "") =>
  checklist.push({ step, status, detail: detail || undefined });

/** Lance une commande, renvoie { code, stdout, stderr }. */
function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd: opts.cwd || root, env: { ...process.env, ...(opts.env || {}) }, shell: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Crée (idempotent) un enregistrement CNAME Cloudflare. */
async function cloudflareCname(name, content) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zone) return { ok: false, reason: "CLOUDFLARE_API_TOKEN/ZONE_ID absents" };
  const base = `https://api.cloudflare.com/client/v4/zones/${zone}/dns_records`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  // Idempotence : on recherche un CNAME existant pour ce nom.
  const list = await fetch(`${base}?name=${encodeURIComponent(name)}&type=CNAME`, { headers });
  const listJson = await list.json().catch(() => ({}));
  if (Array.isArray(listJson.result) && listJson.result.length > 0) {
    return { ok: true, reason: "existant (skip)" };
  }
  const res = await fetch(base, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "CNAME", name, content, proxied: false, comment: "en-ondes provision" }),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) return { ok: false, reason: (json.errors && JSON.stringify(json.errors)) || `HTTP ${res.status}` };
  return { ok: true };
}

try {
  // ─── Radio source de vérité ────────────────────────────────────────────────
  const { rows } = await pool.query("SELECT id, slug, name, status, plan, domains FROM radios WHERE slug = $1 LIMIT 1", [slug]);
  if (!rows[0]) {
    console.error(`[provision] ❌ radio « ${slug} » introuvable — la créer via POST /v1/owner/radios d'abord.`);
    process.exit(1);
  }
  const radio = rows[0];
  console.log(`[provision] radio : ${radio.slug} (${radio.name}) — status=${radio.status}, plan=${radio.plan || "—"}`);

  if (!activateOnly) {
    // ─── 1. build-all ─────────────────────────────────────────────────────────
    if (skipBuild) {
      note("build-all", "skip", "--skip-build");
    } else {
      // Sans BRAND=<slug>, build-all bâtirait la baseline hitsdance (piège ops) :
      // on passe explicitement la marque de la radio provisionnée.
      console.log(`\n[provision] 1/4 build-all : BRAND=${slug} npm run build`);
      const r = await run("npm", ["run", "build"], { env: { BRAND: slug } });
      note("build-all", r.code === 0 ? "ok" : "fail", r.code === 0 ? `site statique généré (BRAND=${slug})` : (r.stderr || r.stdout).slice(-300));
    }

    // ─── 2. Railway ───────────────────────────────────────────────────────────
    if (skipRailway) {
      note("railway", "skip", "--skip-railway");
    } else if (process.env.RAILWAY_TOKEN) {
      console.log("\n[provision] 2/4 Railway : railway up (RAILWAY_TOKEN présent)");
      const r = await run("railway", ["up"]);
      note("railway", r.code === 0 ? "ok" : "fail", r.code === 0 ? "déploiement lancé" : (r.stderr || r.stdout).slice(-300));
    } else {
      note("railway", "manual", "RAILWAY_TOKEN absent — exécuter : railway link (projet du client) && railway up");
    }

    // ─── 3. DNS (Cloudflare) ──────────────────────────────────────────────────
    if (skipDns) {
      note("dns", "skip", "--skip-dns");
    } else if (siteTarget || apiTarget || adminTarget) {
      console.log("\n[provision] 3/4 DNS Cloudflare : création CNAME");
      const want = [
        ["site", siteTarget],
        ["api", apiTarget],
        ["admin", adminTarget],
      ].filter(([, t]) => t);
      const domains = Array.isArray(radio.domains) ? radio.domains : [];
      for (const [kind, target] of want) {
        // Résolution du sous-domaine : on prend le 1er domaine du registre correspondant,
        // sinon on dérive <slug>-<kind>.<apex>. L'apex vient de CLOUDFLARE_APEX (env).
        const apex = process.env.CLOUDFLARE_APEX || "enondes.ca";
        const name = domains.find((d) => d.includes(kind)) || `${slug}-${kind}.${apex}`;
        const res = await cloudflareCname(name, target);
        note(`dns/${kind}`, res.ok ? "ok" : "manual", `${name} -> ${target} : ${res.reason || "créé"}`);
      }
    } else {
      note("dns", "manual", "cibles Railway non fournies (--site-target etc.) — créer les CNAME après déploiement Railway");
    }
  } else {
    console.log("\n[provision] --activate-only : saut de build/railway/dns.");
  }

  // ─── 4. Activation provisioning -> active ───────────────────────────────────
  if (skipActivate) {
    note("activate", "skip", "--skip-activate");
  } else {
    const r = await pool.query(
      "UPDATE radios SET status='active', updated_at=now() WHERE slug=$1 AND status<>'active' RETURNING id, status",
      [slug],
    );
    note("activate", r.rows[0] ? "ok" : "noop", r.rows[0] ? "status -> active" : "déjà active (ou absente)");
  }

  // ─── Rapport ────────────────────────────────────────────────────────────────
  console.log("\n[provision] rapport :");
  for (const c of checklist) {
    const icon = c.status === "ok" ? "✓" : c.status === "skip" ? "·" : c.status === "manual" ? "✋" : "✗";
    console.log(`  ${icon} ${c.step.padEnd(12)} ${c.status}${c.detail ? " — " + c.detail : ""}`);
  }
  const hardFail = checklist.some((c) => c.status === "fail");
  console.log(
    hardFail
      ? "\n[provision] ⚠️ étapes en échec — inspecter ci-dessus. Radio activée malgré tout si l'étape 4 ok."
      : "\n[provision] ✓ provisioning terminé. Étapes « manual » restent à exécuter à la main.",
  );
  process.exit(hardFail ? 1 : 0);
} catch (err) {
  console.error("[provision] échec :", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
