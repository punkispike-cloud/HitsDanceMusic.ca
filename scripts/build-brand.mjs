/* Hits Dance Music — Build Brand (productisation multi-radio)
 *
 * Injecte la marque du client ACTIF (brand/<BRAND>.json) dans le site :
 *   1. Génère  js/brand.generated.js  (config runtime : nom, flux, URLs).
 *   2. Génère  styles/brand.css        (override des variables de couleur).
 *   3. Remplace les valeurs « baseline » (Hits Dance Music) par celles du
 *      client dans : *.html racine, _partials/*.html, manifest.webmanifest, nginx.conf.
 *
 * La baseline = brand/hitsdance.json. Donc BRAND=hitsdance (défaut) est un
 * NO-OP : la sortie reste identique au site actuel (garde-fou de non-régression).
 *
 * ⚠️ RÈGLE : un build client part TOUJOURS d'un arbre propre = la baseline
 * hitsdance (les remplacements vont de baseline → client). Pour REBÂTIR un client
 * après un changement de config, d'abord restaurer la baseline :
 *     git checkout main -- .        # remet les fichiers de sortie à la baseline
 *     BRAND=<client> node scripts/build-all.mjs
 * (Sinon une valeur déjà remplacée par un build précédent reste figée.)
 *
 * Usage :
 *   node scripts/build-brand.mjs                 # applique BRAND (défaut hitsdance)
 *   BRAND=demo node scripts/build-brand.mjs      # bâtit la marque "demo"
 *   node scripts/build-brand.mjs --check         # exit 1 si quelque chose changerait
 */

import { readFile, writeFile, readdir, cp, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const checkMode = process.argv.includes("--check");
const BRAND = process.env.BRAND || "hitsdance";

const baseline = JSON.parse(await readFile(join(root, "brand", "hitsdance.json"), "utf-8"));
const active = JSON.parse(await readFile(join(root, "brand", `${BRAND}.json`), "utf-8"));
console.log(`[build-brand] marque active : ${active.slug} (${active.name})`);

/* ---- Fichiers générés ---- */

function genBrandJs(b) {
  return `/* GÉNÉRÉ par scripts/build-brand.mjs — NE PAS ÉDITER À LA MAIN.
   Config runtime de la marque (lue par api-config.js / now-playing.js). */
export const BRAND = {
  name: ${JSON.stringify(b.name)},
  stream: { url: ${JSON.stringify(b.stream.url)}, panel: ${JSON.stringify(b.stream.panel)} },
  urls: { api: ${JSON.stringify(b.urls.api)}, presenceWss: ${JSON.stringify(b.urls.presenceWss)} },
};
`;
}

function genBrandCss(b) {
  const rgb = b.colors.accentGlowRgb;
  return `/* GÉNÉRÉ par scripts/build-brand.mjs — NE PAS ÉDITER À LA MAIN.
   Override des variables de couleur de la marque (importé en dernier). */
:root {
  --accent-glow-rgb: ${rgb};
  --accent: ${b.colors.accent};
  --accent-bright: ${b.colors.accentBright};
  --accent-glow: rgba(var(--accent-glow-rgb), 0.42);
  --amber: ${b.colors.amber};
  --amber-soft: ${b.colors.amberSoft};
  --amber-glow: rgba(var(--accent-glow-rgb), 0.35);
  --amber-slot: ${b.colors.amber};
  --shadow-warm: 0 12px 40px rgba(var(--accent-glow-rgb), 0.14);
  --shadow-glow-play: 0 12px 40px rgba(var(--accent-glow-rgb), 0.52);
  --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px rgba(var(--accent-glow-rgb), 0.9);
}
`;
}

/* ---- Remplacements baseline → client ---- */

function pairs(from, to) {
  const out = [
    [from.name, to.name],
    [from.description, to.description],
    [from.urls.presenceWss, to.urls.presenceWss],
    [from.urls.api, to.urls.api],
    // Flux / now-playing (nginx) : proxy complet d'abord, puis l'hôte seul.
    [from.stream?.nowPlayingProxy, to.stream?.nowPlayingProxy],
    [from.stream?.host, to.stream?.host],
    [from.domain, to.domain],
    [from.contact.phone, to.contact.phone],
    [from.colors.themeColor, to.colors.themeColor],
    [from.colors.bgColor, to.colors.bgColor],
  ].filter(([a, b]) => a && b && a !== b);
  // Remplacer les chaînes les plus longues d'abord (évite les recoupements).
  out.sort((x, y) => y[0].length - x[0].length);
  return out;
}

function applyReplacements(content, reps) {
  let out = content;
  for (const [a, b] of reps) out = out.split(a).join(b);
  return out;
}

/* ---- Collecte des fichiers à (ré)écrire ---- */

const reps = pairs(baseline, active);
const outputs = new Map(); // path absolu → nouveau contenu

outputs.set(join(root, "js", "brand.generated.js"), genBrandJs(active));
outputs.set(join(root, "styles", "brand.css"), genBrandCss(active));

const rootFiles = await readdir(root);
const htmlFiles = rootFiles.filter((f) => f.endsWith(".html") && !f.startsWith("_"));
const partials = (await readdir(join(root, "_partials")).catch(() => []))
  .filter((f) => f.endsWith(".html"))
  .map((f) => join("_partials", f));
const textTargets = [...htmlFiles, ...partials, "manifest.webmanifest", "nginx.conf"];

for (const rel of textTargets) {
  const path = join(root, rel);
  const before = await readFile(path, "utf-8").catch(() => null);
  if (before == null) continue;
  outputs.set(path, applyReplacements(before, reps));
}

/* ---- Écriture / vérification ---- */

let diffs = 0;
for (const [path, next] of outputs) {
  const before = await readFile(path, "utf-8").catch(() => null);
  if (before === next) continue;
  diffs++;
  const rel = path.slice(root.length + 1).replace(/\\/g, "/");
  if (checkMode) {
    console.log(`[build-brand] ✗ ${rel} hors sync`);
  } else {
    await writeFile(path, next, "utf-8");
    console.log(`[build-brand] ✓ ${rel}`);
  }
}

if (checkMode && diffs > 0) {
  console.error(`[build-brand] ${diffs} fichier(s) hors sync — relance sans --check`);
  process.exit(1);
}

/* ---- Assets du client → assets/ ---- */
// Si le client a un dossier brand/<slug>/assets/ (logo, favicon, icônes…), on en
// copie le contenu dans assets/. hitsdance n'a pas ce dossier → no-op (les assets
// actuels restent en place). Ignoré en --check (binaires, hors hash texte).
const clientAssets = join(root, "brand", active.slug, "assets");
let copied = 0;
if (!checkMode) {
  try {
    await access(clientAssets);
    await cp(clientAssets, join(root, "assets"), { recursive: true, force: true });
    copied = (await readdir(clientAssets)).length;
    console.log(`[build-brand] ✓ ${copied} asset(s) copiés depuis brand/${active.slug}/assets/`);
  } catch {
    /* pas de dossier d'assets client → on garde les assets en place */
  }
}

console.log(`[build-brand] OK (${diffs} fichier·s ${checkMode ? "à régénérer" : "écrits"})`);
