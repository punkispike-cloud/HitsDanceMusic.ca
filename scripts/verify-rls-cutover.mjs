#!/usr/bin/env node
/* En Ondes — Porte de readiness pour la bascule RLS prod (DATABASE_URL → enondes_app).
 *
 * Read-only : ne touche AUCUNE variable Railway. Orchestre les vérifications HTTP
 * préalables et affiche la checklist manuelle + la séquence de cutover exacte.
 *
 * Le seul moment sensible du plan de remédiation (Phase 2.1) : la prod reste live,
 * on bascule le rôle de connexion de l'API de owner → enondes_app (NOBYPASSRLS).
 * Prérequis temporel : ~2 semaines de stabilité staging sur enondes_app (RUNBOOK §3.1).
 *
 * Sortie : exit 0 = toutes les portes HTTP vertes, prêt pour la checklist humaine ;
 *          exit 1 = au moins une porte HTTP rouge — ne pas basculer.
 *
 * Usage :
 *   node scripts/verify-rls-cutover.mjs
 */
import { spawnSync } from "node:child_process";

const STAGING = "https://patient-endurance-staging.up.railway.app";
const PROD = "https://patient-endurance-production-21c8.up.railway.app";

function runVerify(label, url) {
  console.log(`\n▶ ${label} — ${url}`);
  const r = spawnSync(process.execPath, ["scripts/verify-deploy.mjs", url], {
    stdio: "inherit",
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return r.status === 0;
}

console.log("════════════════════════════════════════════════════════════════");
console.log("  Porte de readiness — bascule RLS prod (DATABASE_URL → enondes_app)");
console.log("════════════════════════════════════════════════════════════════");

let ok = true;
if (!runVerify("Staging (déjà sur enondes_app — stabilité)", STAGING)) ok = false;
if (!runVerify("Prod (encore owner — sain avant bascule)", PROD)) ok = false;

console.log("\n────────────────────────────────────────────────────────────────");
console.log("  Checklist humaine (chaque case doit être vraie avant de basculer)");
console.log("────────────────────────────────────────────────────────────────");
console.log(`  [ ] Staging sur enondes_app stable depuis ~2 semaines
      (activation staging datée du 2026-08-15 — ne pas basculer avant ~2026-08-29)
  [ ] \`npm --prefix api run test:rls\` VERT avec RLS_TEST_URL = enondes_app
      (DATABASE_URL = owner pour le setup) — isolation confirmée sur rôle applicatif
  [ ] Snapshot Postgres prod pris avant bascule (PITR Railway activé)
  [ ] \`MIGRATE_DATABASE_URL\` (owner) déjà posé sur prod patient-endurance
      (sinon le preDeploy migrate+seed échoue — DDL refusé à enondes_app)
  [ ] \`DATABASE_URL\` prod actuel sauvegardé (rollback rapide)
  [ ] Fenêtre de maintenance / faible trafic choisie`);

console.log("\n────────────────────────────────────────────────────────────────");
console.log("  Séquence de cutover (à exécuter une fois la checklist 100% verte)");
console.log("────────────────────────────────────────────────────────────────");
console.log(`  1. railway environment link production
  2. railway variable set --service patient-endurance --stdin DATABASE_URL
     (coller l'URL enondes_app : hostname interne Railway + user enondes_app)
     — garder MIGRATE_DATABASE_URL = owner intact
  3. railway redeploy --service patient-endurance   (ou attendre le redeploy auto)
  4. npm run verify:prod                             (doit rester vert)
  5. (optionnel) npm --prefix api run test:rls       (avec RLS_TEST_URL prod enondes_app)
  6. Surveiller Sentry /health ~15 min`);

console.log("\n────────────────────────────────────────────────────────────────");
console.log("  Rollback (si verify:prod rouge après bascule)");
console.log("────────────────────────────────────────────────────────────────");
console.log("  Reposer DATABASE_URL prod = URL owner sauvegardée (étape pré-bascule),");
console.log("  redeploy patient-endurance, npm run verify:prod. Aucune migration à");
console.log("  inverser (la 0027 est additive — pas de DROP).");

if (ok) {
  console.log("\n✅ Portes HTTP vertes — procéder à la checklist humaine ci-dessus.\n");
  process.exit(0);
} else {
  console.log("\n❌ Au moins une porte HTTP est rouge — NE PAS basculer. Corriger d'abord.\n");
  process.exit(1);
}
