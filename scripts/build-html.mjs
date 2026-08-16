/* Hits Dance Music — Build HTML
 *
 * Résout les markers <!--#include name="X"--> ... <!--#endinclude--> dans
 * les fichiers HTML de la racine en remplaçant le contenu interne par celui
 * de `_partials/X.html`. Idempotent : ré-exécuter sur du HTML déjà résolu
 * donne le même résultat.
 *
 * Usage :
 *   node scripts/build-html.mjs            # met à jour tous les *.html
 *   node scripts/build-html.mjs --check    # exit 1 si quelque chose changerait
 *
 * À exécuter après chaque modification d'un fichier dans `_partials/`.
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const partialsDir = join(root, "_partials");
const checkMode = process.argv.includes("--check");

const INCLUDE_RE = /(<!--#include\s+name="([\w-]+)"-->)([\s\S]*?)(<!--#endinclude-->)/g;

async function loadPartials() {
  const files = await readdir(partialsDir).catch(() => []);
  const map = new Map();
  for (const f of files) {
    if (!f.endsWith(".html")) continue;
    const name = f.replace(/\.html$/, "");
    const body = await readFile(join(partialsDir, f), "utf-8");
    map.set(name, body.replace(/\r\n/g, "\n").replace(/\n+$/, ""));
  }
  return map;
}

function processHtml(content, partials, filename) {
  // Normaliser line endings : tout en LF pour éviter qu'un mix CRLF/LF
  // ne fasse paraître le fichier "modifié" à chaque exécution.
  content = content.replace(/\r\n/g, "\n");
  return content.replace(INCLUDE_RE, (_full, openTag, name, _inner, closeTag) => {
    const partial = partials.get(name);
    if (partial === undefined) {
      throw new Error(`[${filename}] partial inconnu : ${name}`);
    }
    return openTag + "\n" + partial + "\n" + closeTag;
  });
}

const partials = await loadPartials();
console.log(`[build-html] ${partials.size} partials chargés : ${[...partials.keys()].join(", ")}`);

const all = await readdir(root);
const htmlFiles = all.filter((f) => f.endsWith(".html") && !f.startsWith("_"));

// Pages exclues de l'auto-injection du banner mesure d'audience : la page de
// politique elle-même (lien circulaire) et la 404 (page d'erreur, hors parcours).
const BANNER_EXCLUDE = new Set(["confidentialite.html", "404.html"]);
const BANNER_MARKER = '<!--#include name="audience-banner"--><!--#endinclude-->';

/** Injecte le marker du banner audience juste après <body> s'il n'est pas déjà
 *  présent (idempotent). Ne touche QUE la balise <body> — ne jamais remplacer
 *  le skip-link / site-header / nav (régression 2026-08-16 : injection manuelle
 *  avait effacé le header → ticker EN DIRECT absent). */
function ensureBannerMarker(content, filename) {
  if (BANNER_EXCLUDE.has(filename)) return content;
  if (content.includes('<!--#include name="audience-banner"-->')) return content;
  // Remplace uniquement la balise d'ouverture <body ...> (pas de flag g).
  if (!/<body[^>]*>/.test(content)) return content;
  return content.replace(/<body([^>]*)>/, `<body$1>\n${BANNER_MARKER}`);
}

let diffs = 0;

for (const f of htmlFiles) {
  const path = join(root, f);
  const before = await readFile(path, "utf-8");
  const after = processHtml(ensureBannerMarker(before, f), partials, f);
  if (before !== after) {
    diffs++;
    if (checkMode) {
      console.log(`[build-html] ✗ ${f} aurait été modifié`);
    } else {
      await writeFile(path, after, "utf-8");
      console.log(`[build-html] ✓ ${f} mis à jour`);
    }
  } else {
    console.log(`[build-html]   ${f} à jour`);
  }
}

if (checkMode && diffs > 0) {
  console.error(`[build-html] ${diffs} fichier(s) hors sync — relance sans --check`);
  process.exit(1);
}
console.log(`[build-html] OK (${htmlFiles.length} HTML traités, ${diffs} modifié·s)`);
