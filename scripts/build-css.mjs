/* Hits Dance Music — Bundle CSS (Phase 5, étape 1).
 *
 * Remplace la résolution runtime de la chaîne de 33 @import de styles.css par
 * UN artefact compilé et ordonné (styles.bundle.css), via Lightning CSS qui
 * inline les imports DANS L'ORDRE SOURCE → cascade préservée bit-à-bit.
 *
 * Étape 1 = iso-rendu : aucune transformation agressive (pas de cible navigateur
 * → pas de réécriture de préfixes). Le seul but est de prouver que le bundle
 * rend exactement comme la cascade actuelle (cf. tests/visual).
 *
 * Minification (P2, option de prod) : passer CSS_MINIFY=1 pour produire un
 * bundle minifié (whitespace + commentaires + raccourcis sémantiquement équivalents).
 * Par défaut (sans env) le bundle reste NON minifié = référence iso-rendu versionnée.
 * Le bundle minifié est un artefact de déploiement : NE PAS le committer (sinon le
 * `--check` par défaut échoue). Les tests visuels tournent sur le bundle non minifié.
 *
 * Usage :
 *   node scripts/build-css.mjs                 # génère styles.bundle.css (non minifié)
 *   CSS_MINIFY=1 node scripts/build-css.mjs    # génère un bundle minifié (prod)
 *   node scripts/build-css.mjs --check         # CI : échoue si le bundle n'est pas à jour
 */

import { bundle } from "lightningcss";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "styles.css");
const outFile = join(root, "styles.bundle.css");
const isCheck = process.argv.includes("--check");
const minify = process.env.CSS_MINIFY === "1";

function build() {
  const { code } = bundle({
    filename: entry,
    minify,          // iso-rendu par défaut ; CSS_MINIFY=1 → minification prod
    sourceMap: false,
    // pas de `targets` → Lightning ne réécrit pas les préfixes vendeurs
  });
  return Buffer.from(code).toString("utf8");
}

let css;
try {
  css = build();
} catch (err) {
  console.error("[build-css] échec du bundling :", err.message);
  process.exit(1);
}

const banner = `/* GÉNÉRÉ par scripts/build-css.mjs — NE PAS ÉDITER À LA MAIN. Source : styles.css (+ styles/*.css).${minify ? " [minifié prod]" : ""} */\n`;
const output = banner + css;

if (isCheck) {
  const current = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
  if (current !== output) {
    console.error(`[build-css] styles.bundle.css n'est PAS à jour (mode ${minify ? "minifié" : "non minifié"}) — relance \`node scripts/build-css.mjs\`.`);
    process.exit(1);
  }
  console.log(`[build-css] styles.bundle.css à jour ✓ (${minify ? "minifié" : "non minifié"})`);
} else {
  writeFileSync(outFile, output);
  console.log(`[build-css] styles.bundle.css écrit (${output.length} octets, ${minify ? "minifié" : "non minifié"}).`);
}
