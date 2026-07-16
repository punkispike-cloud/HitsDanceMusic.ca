/* En Ondes — Génère la paperasse commerciale d'un client depuis les gabarits privés.
 *
 Remplit _private/CONTRAT-CLIENT.md + _private/ATTESTATION-LICENCES.md avec les
 infos du client et écrit les copies dans _private/clients/<slug>/. Les signatures
 restent vides (signature manuscrite/électronique à part). Les montants renvoient à
 GRILLE-PRIX.md (annexe) — on n'écrit pas de montant dans le contrat.
 *
 ⚠️ Les gabarits sont NON juridiques : validation par avocat·e requise avant usage.
 *
 Usage :
 *   node scripts/gen-paperwork.mjs --slug rockradio --legal-name "Rockfort inc." \
 *     --radio "Rockfort" --domain rockfort.ca
 *   (--radio/--domain default depuis brand/clients.json si absents)
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const privateDir = join(root, "_private");

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const key = a.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) {
    args[key] = next;
    i++;
  } else {
    args[key] = "true";
  }
}

const slug = (args.slug || "").trim().toLowerCase();
const legalName = (args["legal-name"] || "").trim();
if (!slug || !legalName) {
  console.error("[gen-paperwork] --slug et --legal-name requis.");
  process.exit(2);
}

// Valeurs par défaut depuis brand/clients.json (si présent).
let radioName = args.radio || "";
let domain = args.domain || "";
try {
  const reg = JSON.parse(await readFile(join(root, "brand", "clients.json"), "utf-8"));
  const c = (reg.clients || []).find((x) => x.slug === slug);
  if (c) {
    radioName = radioName || c.name || "";
    domain = domain || c.domains?.site || "";
  }
} catch {
  /* clients.json privé absent — on utilise les args */
}
if (!radioName) radioName = slug;
if (!domain) domain = `${slug}.ca`;
const date = new Date().toLocaleDateString("fr-CA", { year: "numeric", month: "long", day: "numeric" });

function fillContract(tpl) {
  return tpl
    .replace(/(\*\*et\*\* :)\s*_{2,}( \(nom légal\))/, `$1 ${legalName}$2`)
    .replace(
      /(\*\*Date\*\* :)\s*_+(\s+\*\*Radio\*\* :)\s*_+(\s+\*\*Domaine\*\* :)\s*_+/,
      `$1 ${date}$2 ${radioName}$3 ${domain}`,
    );
}

function fillAttestation(tpl) {
  // On remplit l'en-tête (Radio / Client / Date) — on laisse les blocs signature vides.
  // Seul le 1er « **Date** : ___ » de l'en-tête est rempli (celui de la signature reste vide).
  let filled = tpl
    .replace(/(\*\*Radio\*\* :)\s*_+/, `$1 ${radioName}`)
    .replace(/(\*\*Client \(nom légal\)\*\* :)\s*_+/, `$1 ${legalName}`);
  filled = filled.replace(/(\*\*Date\*\* :)\s*_+/, `$1 ${date}`);
  return filled;
}

const outDir = join(privateDir, "clients", slug);
await mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);

const contratTpl = await readFile(join(privateDir, "CONTRAT-CLIENT.md"), "utf-8");
const attTpl = await readFile(join(privateDir, "ATTESTATION-LICENCES.md"), "utf-8");

const contratOut = join(outDir, `CONTRAT-${slug}-${stamp}.md`);
const attOut = join(outDir, `ATTESTATION-${slug}-${stamp}.md`);
await writeFile(contratOut, fillContract(contratTpl), "utf-8");
await writeFile(attOut, fillAttestation(attTpl), "utf-8");

console.log(`[gen-paperwork] ✓ paperasse générée pour « ${radioName} » (${slug}) :`);
console.log(`  ${contratOut}`);
console.log(`  ${attOut}`);
console.log(`  ⚠️ Gabarits non juridiques — validation avocat·e + signatures à compléter.`);
