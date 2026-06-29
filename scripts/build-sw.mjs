/* Hits Dance Music — Build Service Worker
 *
 * 1. Calcule un hash SHA-256 court du contenu de toutes les ressources du SHELL.
 * 2. Remplace la valeur de CACHE dans sw.js par "hitradio-<hash>".
 *
 * Garantit qu'une modif de n'importe quel fichier du shell invalide le cache
 * sans intervention manuelle.
 *
 * Usage :
 *   node scripts/build-sw.mjs            # met à jour sw.js
 *   node scripts/build-sw.mjs --check    # exit 1 si hash hors sync
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const swPath = join(root, "sw.js");
const checkMode = process.argv.includes("--check");

// Extraire la liste SHELL du sw.js (source unique de vérité)
const swText = await readFile(swPath, "utf-8");
const shellMatch = swText.match(/const\s+SHELL\s*=\s*\[([\s\S]*?)\];/);
if (!shellMatch) {
  console.error("[build-sw] Impossible de trouver SHELL dans sw.js");
  process.exit(2);
}
const shellEntries = [...shellMatch[1].matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]).filter(Boolean);
console.log(`[build-sw] ${shellEntries.length} ressources dans le SHELL`);

// Détection de drift : avertir si un module js/ n'est pas dans le SHELL.
// Source classique de drift offline = un nouveau module oublié du précache.
// (Warning seulement — n'échoue pas le build : certains fichiers peuvent être
// intentionnellement exclus, ex. scripts de test.)
const shellSet = new Set(shellEntries);
try {
  const jsFiles = (await readdir(join(root, "js"))).filter((f) => f.endsWith(".js"));
  const untracked = jsFiles.filter((f) => !shellSet.has(`js/${f}`));
  if (untracked.length) {
    console.warn(`[build-sw] ⚠ ${untracked.length} module(s) js/ hors SHELL : ${untracked.join(", ")}`);
  }
} catch { /* pas de dossier js/ — ignore */ }

// Extensions texte : on normalise les fins de ligne (CRLF → LF) AVANT de hacher
// pour que le hash soit identique quel que soit le checkout (Windows CRLF vs
// Linux/CI LF). Sinon le hash committé depuis Windows ne matche pas la CI.
const TEXT_EXT = new Set([
  ".html", ".css", ".js", ".mjs", ".json", ".webmanifest", ".svg", ".txt", ".map",
]);
function isText(rel) {
  const dot = rel.lastIndexOf(".");
  return dot >= 0 && TEXT_EXT.has(rel.slice(dot).toLowerCase());
}

// Hasher chaque fichier dans l'ordre stable
const hash = createHash("sha256");
let missing = 0;
for (const rel of shellEntries) {
  const fp = join(root, rel);
  try {
    let buf = await readFile(fp);
    if (isText(rel)) buf = Buffer.from(buf.toString("utf-8").replace(/\r\n/g, "\n"), "utf-8");
    hash.update(rel);
    hash.update("\0");
    hash.update(buf);
    hash.update("\0");
  } catch {
    missing++;
    if (missing < 5) console.warn(`[build-sw]   manquant : ${rel}`);
  }
}
if (missing) console.warn(`[build-sw] ${missing} fichier(s) manquant·s (ignorés dans le hash)`);

const short = hash.digest("hex").slice(0, 12);
const newCacheName = `hitradio-${short}`;
const cacheRe = /const\s+CACHE\s*=\s*"([^"]+)";/;
const cacheMatch = swText.match(cacheRe);
if (!cacheMatch) {
  console.error("[build-sw] Impossible de trouver CACHE dans sw.js");
  process.exit(2);
}
const current = cacheMatch[1];

if (current === newCacheName) {
  console.log(`[build-sw] CACHE déjà à jour : ${current}`);
  process.exit(0);
}

console.log(`[build-sw] ${current}  →  ${newCacheName}`);

if (checkMode) {
  console.error("[build-sw] hors sync — relance sans --check");
  process.exit(1);
}

const newSwText = swText.replace(cacheRe, `const CACHE = "${newCacheName}";`);
await writeFile(swPath, newSwText, "utf-8");
console.log("[build-sw] sw.js mis à jour");
