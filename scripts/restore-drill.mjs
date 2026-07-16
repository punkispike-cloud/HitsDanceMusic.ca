/* En Ondes — Drill de restauration Postgres automatisé et répétable.
 *
 * Remplace l'exercice manuel du 2026-06-22 (pg_dump -> base jetable -> vérif) par un
 * script unique. Nécessite les binaires `pg_dump`, `pg_restore`, `psql` sur le PATH.
 * N'ajoute AUCUNE dépendance JS : tout passe par les binaires Postgres.
 *
 * Variables d'environnement :
 *   SOURCE_DATABASE_URL   (requis) connexion read-only de la prod (DATABASE_PUBLIC_URL)
 *   DRILL_ADMIN_URL       (requis) connexion à une base d'administration du même serveur
 *                          (ex. .../postgres) dotée du droit CREATE DATABASE
 *   DRILL_DB_NAME         (défaut restore_drill) nom de la base jetable
 *   KEEP_DRILL_DB         (défaut faux) garder la base restaurée pour inspection
 *   DRILL_REPORT          (optionnel) chemin d'un fichier .json pour le rapport
 *
 * Étapes : preflight -> ping source -> DROP+CREATE base jetable -> pg_dump (timé) ->
 * pg_restore (timé, RTO) -> vérif parité (scripts/lib/db-verify.mjs) -> DROP base jetable
 * -> rapport. Exit 0 si tout vert, 1 sinon.
 *
 * NB : ne JAMAIS câbler ce script dans preDeployCommand — la restauration reste un
 * geste ops manuel/planifié.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyDbParity, formatParityReport } from "./lib/db-verify.mjs";

const execFileAsync = promisify(execFile);

const sourceUrl = process.env.SOURCE_DATABASE_URL || "";
const adminUrl = process.env.DRILL_ADMIN_URL || "";
const drillDbName = process.env.DRILL_DB_NAME || "restore_drill";
const keepDrillDb = /^(1|true|yes)$/i.test(process.env.KEEP_DRILL_DB || "");
const reportPath = process.env.DRILL_REPORT || "";

if (!sourceUrl || !adminUrl) {
  console.error(
    "[restore-drill] SOURCE_DATABASE_URL et DRILL_ADMIN_URL sont requis.\n" +
      "  SOURCE_DATABASE_URL = connexion read-only prod (DATABASE_PUBLIC_URL)\n" +
      "  DRILL_ADMIN_URL     = connexion admin (ex. .../postgres) avec CREATE DATABASE",
  );
  process.exit(2);
}

const log = (msg) => console.log(`[restore-drill] ${msg}`);
const fail = (msg) => {
  console.error(`[restore-drill] ECHEC : ${msg}`);
  process.exit(1);
};

/** Vérifie qu'un binaire est disponible sur le PATH via `--version`. */
async function assertBinary(name) {
  try {
    await execFileAsync(name, ["--version"]);
  } catch {
    throw new Error(`binaire '${name}' introuvable sur le PATH.`);
  }
}

/** Remplace le nom de la base dans une URL postgres://.../dbname?params. */
function swapDb(connectionUrl, newDb) {
  const u = new URL(connectionUrl);
  u.pathname = `/${newDb}`;
  return u.toString();
}

async function run(label, bin, args, opts = {}) {
  const t0 = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      maxBuffer: 64 * 1024 * 1024,
      env: process.env,
      ...opts,
    });
    const ms = Date.now() - t0;
    if (stderr && stderr.trim()) process.stderr.write(`  (${label}) ${stderr.trim()}\n`);
    return { ms, stdout };
  } catch (err) {
    throw new Error(`${label} : ${err.message}`);
  }
}

// --- Préflight -------------------------------------------------------------
log("preflight : pg_dump / pg_restore / psql...");
try {
  await Promise.all([
    assertBinary("pg_dump"),
    assertBinary("pg_restore"),
    assertBinary("psql"),
  ]);
} catch (err) {
  fail(err.message);
}

const targetUrl = swapDb(adminUrl, drillDbName);
const startedAt = new Date().toISOString();
log(`base jetable : ${drillDbName} (cible ${targetUrl.replace(/\/\/[^@]*@/, "//***@")})`);

// --- Ping source -----------------------------------------------------------
log("ping source...");
try {
  await run("ping", "psql", [sourceUrl, "-t", "-A", "-c", "SELECT 1"]);
} catch (err) {
  fail(`source injoignable : ${err.message}`);
}

// --- Prépare la base jetable ----------------------------------------------
log(`préparation base jetable (DROP + CREATE ${drillDbName})...`);
const ident = `"${drillDbName.replace(/"/g, '""')}"`;
try {
  await run("drop", "psql", [adminUrl, "-c", `DROP DATABASE IF EXISTS ${ident}`]);
  await run("create", "psql", [adminUrl, "-c", `CREATE DATABASE ${ident}`]);
} catch (err) {
  fail(err.message);
}

const dumpDir = await mkdtemp(join(tmpdir(), "restore-drill-"));
const dumpFile = join(dumpDir, "prod.dump");
let dumpMs = 0;
let restoreMs = 0;
let parity = null;

try {
  // --- Dump source (custom format) --------------------------------------
  log("pg_dump de la source (format custom)...");
  ({ ms: dumpMs } = await run("pg_dump", "pg_dump", [sourceUrl, "-Fc", "-f", dumpFile]));
  log(`dump ok en ${dumpMs} ms`);

  // --- Restore dans la base jetable (RTO) -------------------------------
  log("pg_restore vers la base jetable...");
  ({ ms: restoreMs } = await run(
    "pg_restore",
    "pg_restore",
    ["--no-owner", "--no-acl", "-d", targetUrl, dumpFile],
    // pg_restore renvoie un exit code non-zero sur des avertissements bénins ;
    // on capture stderr mais on n'échoue pas sur les warnings d'acl/owner.
  ));
  log(`restore ok en ${restoreMs} ms`);

  // --- Vérification parité ---------------------------------------------
  log("vérification parité (comptes + empreintes)...");
  try {
    parity = await verifyDbParity(sourceUrl, targetUrl);
  } catch (err) {
    fail(`vérification : ${err.message}`);
  }
  console.log(formatParityReport(parity));
} finally {
  // --- Teardown : drop base + fichier dump ------------------------------
  if (!keepDrillDb) {
    try {
      await run("drop-final", "psql", [adminUrl, "-c", `DROP DATABASE IF EXISTS ${ident}`]);
      log(`base jetable ${drillDbName} supprimée.`);
    } catch (err) {
      console.error(`[restore-drill] nettoyage base jetable échoué : ${err.message}`);
    }
  } else {
    log(`KEEP_DRILL_DB=1 : base jetable ${drillDbName} conservée pour inspection.`);
  }
  await unlink(dumpFile).catch(() => {});
}

const ok = parity?.ok === true;
const report = {
  startedAt,
  finishedAt: new Date().toISOString(),
  ok,
  drillDbName,
  kept: keepDrillDb,
  timings: { dumpMs, restoreMs, rtoMs: restoreMs },
  parity,
};

if (reportPath) {
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
  log(`rapport écrit : ${reportPath}`);
}

log("---- bilan ----");
log(`dump   : ${(dumpMs / 1000).toFixed(1)} s`);
log(`restore (RTO) : ${(restoreMs / 1000).toFixed(1)} s`);
log(`parité : ${ok ? "OK (source = cible)" : `DIFF sur ${parity?.mismatches.join(", ")}`}`);
log(ok ? "drill reussi." : "drill en echec (ecarts detectes).");
process.exit(ok ? 0 : 1);
