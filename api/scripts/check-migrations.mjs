#!/usr/bin/env node
/* Garde des migrations : toute migration qui DÉTRUIT de la donnée doit être
 * accompagnée de son fichier de retour arrière.
 *
 * POURQUOI CE GARDE PLUTÔT QUE 32 FICHIERS `down`
 * L'audit prod du 21-08 a relevé « 32 migrations, zéro rollback ». La lecture
 * des 32 corrige le constat : AUCUNE ne détruit de donnée. Les seuls DROP sont
 * dans 0009, qui supprime sept index pour les recréer aussitôt portés sur
 * (radio_id, slug) — un index se reconstruit, il ne se perd pas. Écrire
 * rétroactivement 32 fichiers `down` pour des migrations purement additives
 * serait du travail mort : leur annulation est un DROP évident, et un fichier
 * jamais exécuté n'est pas un rollback, c'est une intention.
 *
 * Le vrai risque n'est donc pas derrière nous, il est devant : la PREMIÈRE
 * migration destructive écrite un jour de pression, sans chemin de retour. Ce
 * script la rend impossible à fusionner silencieusement.
 *
 * Il démarre vert (aucune migration destructive aujourd'hui) et le reste tant
 * que personne n'en écrit — un garde qui naît rouge est un garde qu'on ignore.
 *
 * CE QUI COMPTE COMME DESTRUCTIF
 *   DROP TABLE / DROP COLUMN / DROP SCHEMA / DELETE FROM / TRUNCATE
 *   ALTER COLUMN … TYPE      (une conversion peut tronquer)
 *   ALTER COLUMN … SET NOT NULL (échoue sur données existantes sans backfill)
 *
 * CE QUI N'EN EST PAS — et pourquoi le distinguer
 *   DROP INDEX, DROP CONSTRAINT, DROP POLICY, DROP TRIGGER : des objets
 *   dérivés. Les reconstruire depuis le schéma est mécanique, aucune donnée
 *   d'utilisateur n'est en jeu. Les inclure rendrait 0009 rouge sans raison.
 *
 * Usage :
 *   node api/scripts/check-migrations.mjs                  # depuis la racine ou api/
 *   MIGRATIONS_DIR=/tmp/fixture node api/scripts/check-migrations.mjs
 *
 * MIGRATIONS_DIR existe pour que le garde soit lui-même testable sur des
 * fixtures (tests/migrations-guard.test.mjs) : sans ça, prouver qu'il vire au
 * rouge exigerait de salir les vraies migrations.
 */

import { readdir, readFile, access } from "node:fs/promises";
import { dirname, join, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS = process.env.MIGRATIONS_DIR
  ? resolve(process.env.MIGRATIONS_DIR)
  : join(API_ROOT, "migrations");
const DOWN_DIR = join(MIGRATIONS, "down");

/* Motifs destructifs. Le `\b` évite qu'un DROP INDEX passe pour un DROP TABLE,
   et le point d'ancrage sur ALTER COLUMN … TYPE tolère les sauts de ligne. */
const DESTRUCTIVE = [
  { re: /\bDROP\s+TABLE\b/i, why: "DROP TABLE" },
  { re: /\bDROP\s+COLUMN\b/i, why: "DROP COLUMN" },
  { re: /\bDROP\s+SCHEMA\b/i, why: "DROP SCHEMA" },
  { re: /\bDELETE\s+FROM\b/i, why: "DELETE FROM" },
  { re: /\bTRUNCATE\b/i, why: "TRUNCATE" },
  { re: /\bALTER\s+COLUMN\b[\s\S]{0,80}?\bTYPE\b/i, why: "ALTER COLUMN … TYPE (conversion possiblement tronquante)" },
  { re: /\bALTER\s+COLUMN\b[\s\S]{0,80}?\bSET\s+NOT\s+NULL\b/i, why: "SET NOT NULL (échoue sans backfill préalable)" },
];

/** Retire commentaires et littéraux : un « -- on ne DROP jamais la table »
 *  ne doit pas déclencher le garde. */
function stripNoise(sql) {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

const files = (await readdir(MIGRATIONS).catch(() => []))
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error(`[migrations-guard] ❌ aucune migration trouvée dans ${MIGRATIONS}`);
  process.exit(1);
}

const offenders = [];
let destructiveCount = 0;

for (const file of files) {
  const sql = stripNoise(await readFile(join(MIGRATIONS, file), "utf-8"));
  const hits = DESTRUCTIVE.filter((d) => d.re.test(sql)).map((d) => d.why);
  if (hits.length === 0) continue;

  destructiveCount++;
  const down = join(DOWN_DIR, basename(file));
  const hasDown = await access(down).then(() => true).catch(() => false);
  if (!hasDown) offenders.push({ file, hits });
}

console.log(`[migrations-guard] ${files.length} migration(s) analysée(s) · ${destructiveCount} destructive(s)`);

if (offenders.length) {
  console.error("\n[migrations-guard] ❌ migration destructive sans chemin de retour :\n");
  for (const o of offenders) {
    console.error(`  ✗ ${o.file}`);
    for (const h of o.hits) console.error(`      ${h}`);
    console.error(`      → écrire api/migrations/down/${o.file} (SQL qui annule ces effets)`);
  }
  console.error(
    "\n  Un rollback global existe (PITR + sauvegarde quotidienne), mais il ramène\n" +
      "  TOUTE la base à un instant : il ne peut pas annuler une seule migration.\n" +
      "  Voir RUNBOOK-PRODUCTION.md § Migration destructive.\n",
  );
  process.exit(1);
}

console.log(
  destructiveCount === 0
    ? "[migrations-guard] ✅ aucune migration destructive — rien à couvrir."
    : `[migrations-guard] ✅ les ${destructiveCount} migration(s) destructive(s) ont leur fichier down/.`,
);
