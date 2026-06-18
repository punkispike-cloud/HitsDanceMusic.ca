/* Orchestrateur de pre-deploy Railway : applique les migrations puis le seed,
   séquentiellement, en relançant chaque script dans son propre process node.

   Pourquoi pas `node migrate.js && node seed.js` directement dans le
   preDeployCommand : Railway n'exécute pas forcément la commande dans un shell,
   donc `&&` n'est pas interprété (seul le 1er script tournerait). Ici, un seul
   binaire (`node dist/db/deploy.js`), sans opérateur shell, garantit l'enchaînement. */

import { execFileSync } from "node:child_process";

function run(script: string): void {
  console.log(`[deploy] → ${script}`);
  // process.execPath = chemin absolu du binaire node courant (robuste).
  execFileSync(process.execPath, [script], { stdio: "inherit" });
}

try {
  run("dist/db/migrate.js");
  run("dist/db/seed.js");
  console.log("[deploy] terminé ✓");
} catch (err) {
  console.error("[deploy] échec", err instanceof Error ? err.message : err);
  process.exit(1);
}
