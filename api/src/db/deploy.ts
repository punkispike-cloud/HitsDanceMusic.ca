/* Orchestrateur de pre-deploy Railway : applique les migrations puis le seed,
   séquentiellement, en relançant chaque script dans son propre process node.

   Pourquoi pas `node migrate.js && node seed.js` directement dans le
   preDeployCommand : Railway n'exécute pas forcément la commande dans un shell,
   donc `&&` n'est pas interprété (seul le 1er script tournerait). Ici, un seul
   binaire (`node dist/db/deploy.js`), sans opérateur shell, garantit l'enchaînement. */

import { execFileSync } from "node:child_process";

/* Runtime API utilise DATABASE_URL (= enondes_app une fois basculé).
   Migrate + seed ont besoin du rôle owner (DDL / bypass RLS) :
   poser MIGRATE_DATABASE_URL sur l'URL postgres owner. Absent → DATABASE_URL. */
const migrateUrl = (process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL || "").trim();
if (!migrateUrl) {
  console.error("[deploy] ❌ DATABASE_URL (ou MIGRATE_DATABASE_URL) manquant");
  process.exit(1);
}
if (process.env.MIGRATE_DATABASE_URL) {
  console.log("[deploy] migrate/seed via MIGRATE_DATABASE_URL (owner)");
}

function run(script: string): void {
  console.log(`[deploy] → ${script}`);
  // process.execPath = chemin absolu du binaire node courant (robuste).
  execFileSync(process.execPath, [script], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: migrateUrl },
  });
}

try {
  run("dist/db/migrate.js");
  run("dist/db/seed.js");
  console.log("[deploy] terminé ✓");
} catch (err) {
  console.error("[deploy] échec", err instanceof Error ? err.message : err);
  process.exit(1);
}
