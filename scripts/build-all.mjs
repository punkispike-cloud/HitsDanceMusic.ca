/* Hits Dance Music — Pipeline de build complet.
 * Ordre IMPÉRATIF :
 *   1. build-brand : injecte la marque (génère brand.css / brand.generated.js, remplace les valeurs)
 *   2. build-css   : bundle la chaîne de @import (brand.css inclus) en styles.bundle.css
 *   3. build-html  : inline les partials dans les *.html
 *   4. build-sw    : recalcule le hash du cache à partir du contenu FINAL
 *
 * Usage :
 *   node scripts/build-all.mjs              # applique BRAND (défaut hitsdance)
 *   BRAND=demo node scripts/build-all.mjs   # bâtit la marque "demo"
 *   node scripts/build-all.mjs --check      # vérifie que tout est à jour (CI)
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const checkArg = process.argv.includes("--check") ? ["--check"] : [];

const steps = ["build-brand.mjs", "build-css.mjs", "build-html.mjs", "build-sw.mjs"];
for (const step of steps) {
  console.log(`\n=== ${step} ${checkArg.join(" ")} ===`);
  const res = spawnSync(process.execPath, [join(here, step), ...checkArg], {
    stdio: "inherit",
    env: process.env,
  });
  if (res.status !== 0) {
    console.error(`[build-all] échec à l'étape ${step}`);
    process.exit(res.status ?? 1);
  }
}
console.log("\n[build-all] pipeline OK ✓");
