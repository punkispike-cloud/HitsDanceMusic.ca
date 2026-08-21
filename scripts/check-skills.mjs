/* Valide les skills projet de .claude/skills/.
 *
 * Pourquoi ce contrôle existe : une skill dont le frontmatter est invalide n'est
 * pas signalée — elle est simplement IGNORÉE au chargement. On croit disposer
 * d'un runbook exécutable alors qu'il ne se déclenchera jamais. Le mode d'échec
 * est donc silencieux, ce qui justifie un garde-fou automatique.
 *
 * Usage : node scripts/check-skills.mjs
 * Exit 1 si une skill est malformée.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SKILLS_DIR = join(root, ".claude", "skills");

/* La description est ce qui décide du déclenchement : trop courte, la skill ne
   s'active jamais au bon moment. Seuil empirique, pas une règle du format. */
const MIN_DESCRIPTION = 60;
const MIN_BODY = 200;

let entries;
try {
  entries = await readdir(SKILLS_DIR, { withFileTypes: true });
} catch {
  console.log("ℹ️  Aucun dossier .claude/skills/ — rien à valider.");
  process.exit(0);
}

const dirs = entries.filter((e) => e.isDirectory());
if (dirs.length === 0) {
  console.log("ℹ️  .claude/skills/ est vide — rien à valider.");
  process.exit(0);
}

let bad = 0;
console.log(`\n🧩 Validation des skills projet — ${dirs.length} trouvée(s)\n`);

for (const d of dirs) {
  const path = join(SKILLS_DIR, d.name, "SKILL.md");
  let src;
  try {
    src = await readFile(path, "utf-8");
  } catch {
    console.log(`  ❌ ${d.name} : SKILL.md manquant`);
    bad++;
    continue;
  }

  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) {
    console.log(`  ❌ ${d.name} : frontmatter absent ou mal délimité`);
    bad++;
    continue;
  }

  const fm = m[1];
  const problems = [];

  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  if (!name) problems.push("champ `name` absent");
  else if (name !== d.name) problems.push(`name "${name}" ≠ dossier "${d.name}"`);

  // La description peut être sur une ligne ou en bloc YAML (`>-`).
  const descBlock = fm.split(/^description:/m)[1]?.split(/^[a-z_]+:/m)[0] ?? "";
  const descLen = descBlock.replace(/^[>|-]+/, "").trim().length;
  if (descLen === 0) problems.push("champ `description` absent");
  else if (descLen < MIN_DESCRIPTION)
    problems.push(`description trop courte (${descLen} car., min ${MIN_DESCRIPTION}) — déclenchement peu fiable`);

  const body = src.slice(m[0].length).trim();
  if (body.length < MIN_BODY) problems.push(`corps trop court (${body.length} car., min ${MIN_BODY})`);

  if (problems.length) {
    console.log(`  ❌ ${d.name} : ${problems.join(" ; ")}`);
    bad++;
  } else {
    console.log(`  ✅ ${d.name.padEnd(20)} description ${descLen} car., corps ${(body.length / 1024).toFixed(1)} ko`);
  }
}

console.log(bad === 0 ? "\n✅ Toutes les skills sont valides.\n" : `\n❌ ${bad} skill(s) invalide(s).\n`);
process.exit(bad === 0 ? 0 : 1);
