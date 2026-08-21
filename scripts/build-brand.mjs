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
   Config runtime de la marque (nom, flux, URLs, contact) : tout module qui
   affiche la marque doit la lire ici plutôt que de la coder en dur. */
export const BRAND = {
  name: ${JSON.stringify(b.name)},
  shortName: ${JSON.stringify(b.shortName || b.name)},
  stream: { url: ${JSON.stringify(b.stream.url)}, panel: ${JSON.stringify(b.stream.panel)} },
  urls: { api: ${JSON.stringify(b.urls.api)}, presenceWss: ${JSON.stringify(b.urls.presenceWss)} },
  contact: { phone: ${JSON.stringify(b.contact?.phone || "")}, email: ${JSON.stringify(b.contact?.email || "")} },
};
`;
}

/* Neutres surchargeables par marque (Phase 5, étape 3b).
   Clé JSON (brand/<slug>.json → palette.semantic.dark) → variable CSS.

   Ces tokens n'étaient PAS paramétrables avant : ils étaient figés dans
   styles/00-base.css pour toutes les marques, si bien qu'un client ne pouvait
   changer que son accent — jamais la profondeur de ses fonds.

   Les ombres n'y figurent volontairement pas : leur géométrie appartient au
   CSS, seule leur couleur serait thématisable, et aucun besoin réel ne le
   justifie aujourd'hui.

   ⚠ PAS exporté : ce fichier s'exécute au chargement (build à effet de bord).
   L'importer pour lire cette table déclencherait un build parasite. */
const SEMANTIC_TOKENS = {
  bg: "--bg",
  bgElevated: "--bg-elevated",
  surface: "--surface",
  surfaceGlass: "--surface-glass",
  surfaceWarm: "--surface-warm",
  vinyl: "--vinyl",
  night: "--night",
  ink: "--ink",
  muted: "--muted",
  line: "--line",
  goldBorder: "--gold-border",
};

/* "#c8102e" → "200, 16, 46". Dérivé de la couleur, JAMAIS redéclaré dans le
   JSON : un second champ finirait par diverger de son hex. */
function hexToRgbList(hex) {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function genBrandCss(b) {
  const rgb = b.colors.accentGlowRgb;

  /* Bloc neutres — n'est émis QUE si la marque déclare palette.semantic.dark.
     Absent (cas de hitsdance, la baseline) ⇒ rien n'est émis et 00-base.css
     garde la main avec ses var(--primitive) : la tokenisation de l'étape 3a
     reste vivante au lieu d'être ré-aplatie en littéraux. Une marque peut
     n'en surcharger qu'une partie — les clés absentes retombent sur la baseline. */
  const semantic = b.palette?.semantic?.dark;
  const semanticBlock = semantic
    ? "\n" +
      Object.entries(SEMANTIC_TOKENS)
        .filter(([key]) => semantic[key])
        .map(([key, cssVar]) => `  ${cssVar}: ${semantic[key]};`)
        .join("\n") +
      "\n"
    : "";

  return `/* GÉNÉRÉ par scripts/build-brand.mjs — NE PAS ÉDITER À LA MAIN.
   Override des variables de couleur de la marque (importé en dernier). */
:root {
  --accent: ${b.colors.accent};
  --accent-bright: ${b.colors.accentBright};
  --accent-glow: rgba(${rgb}, 0.42);
  --amber: ${b.colors.amber};
  --amber-soft: ${b.colors.amberSoft};
  --amber-glow: rgba(${rgb}, 0.35);
  --amber-slot: ${b.colors.amber};
  --shadow-warm: 0 12px 40px rgba(${rgb}, 0.14);
  --shadow-glow-play: 0 12px 40px rgba(${rgb}, 0.52);
  --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px rgba(${rgb}, 0.9);

  /* Canaux RGB — indispensables aux usages en rgba(var(--x), α) des composants.
     Sans eux, ces halos et lueurs resteraient figés sur la couleur de la
     baseline quelle que soit la marque bâtie. */
  --accent-rgb: ${hexToRgbList(b.colors.accent)};
  --accent-bright-rgb: ${hexToRgbList(b.colors.accentBright)};
  --accent-glow-rgb: ${rgb};
${semanticBlock}}
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
    // URLs du flux audio dans le HTML (<source>, liens panel) : complètes,
    // sinon le chemin /proxy/<slug-client>/ de la baseline survivrait au build.
    [from.stream?.url, to.stream?.url],
    [from.stream?.panel, to.stream?.panel],
    [from.domain, to.domain],
    [from.contact.phone, to.contact.phone],
    [from.contact?.email, to.contact?.email],
    // shortName APRÈS name (sous-chaîne) : le tri long→court ci-dessous
    // garantit que « Hits Dance Music » est remplacé avant « Hits Dance ».
    [from.shortName, to.shortName],
    [from.genre, to.genre],
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
// sw.js est une cible texte (titre de notification de marque) : build-brand
// tourne AVANT build-sw dans build-all, donc le hash du shell reste correct.
const textTargets = [...htmlFiles, ...partials, "manifest.webmanifest", "nginx.conf", "sw.js"];

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
