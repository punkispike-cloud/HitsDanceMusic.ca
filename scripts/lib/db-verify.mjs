/* Module partagé : compare deux bases Postgres (source vs cible restaurée) pour un
 * drill de restauration. Utilise le binaire `psql` (déjà requis par le drill) afin de
 * ne pas ajouter de dépendance JS à la racine du dépôt.
 *
 * Vérifie : compte de lignes + empreinte (md5 des ids triés) par table, et parité des
 * migrations Drizzle. Aucune logique métier — pure comparaison structurelle.
 *
 * Export principal : verifyDbParity(sourceUrl, targetUrl, tables?) -> {
 *   ok: boolean, tables: [{name, source:{count,hash}, target:{count,hash}, match}],
 *   migrations: {source, target, match} | null, mismatches: string[]
 * }
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_TABLES = [
  "users",
  "artists",
  "shows",
  "schedule_slots",
  "tracks",
  "analytics_sessions",
  "radios",
];

/** Exécute une requête SQL via psql, sortie machine-readable (-t -A -F '|'). */
async function runPsql(connectionUrl, sql) {
  const { stdout } = await execFileAsync(
    "psql",
    [connectionUrl, "-t", "-A", "-F", "|", "-c", sql],
    { maxBuffer: 16 * 1024 * 1024, env: process.env },
  );
  return stdout;
}

/** Construit une requête UNION ALL renvoyant (table, count, hash) pour chaque table. */
function buildParitySql(tables) {
  return tables
    .map(
      (name) =>
        `SELECT '${name}' AS t, count(*)::text AS c, ` +
        `COALESCE(md5(string_agg(id::text, ',' ORDER BY id)), 'empty') AS h ` +
        `FROM ${name}`,
    )
    .join("\nUNION ALL\n");
}

/** Parse la sortie psql en Map<table, {count, hash}>. */
function parseParity(stdout) {
  const out = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [t, c, h] = line.split("|");
    if (!t) continue;
    out.set(t, { count: c ?? "0", hash: h ?? "" });
  }
  return out;
}

/**
 * Compare source et cible. Renvoie un rapport structuré + liste d'écarts.
 * Une table absente d'une base n'échoue pas tout le drill : elle est marquée
 * mismatch (la cible restaurée devrait contenir les mêmes tables que la source).
 */
export async function verifyDbParity(sourceUrl, targetUrl, tables = DEFAULT_TABLES) {
  const sql = buildParitySql(tables);
  let sourceMap;
  let targetMap;
  try {
    sourceMap = parseParity(await runPsql(sourceUrl, sql));
  } catch (err) {
    throw new Error(`Lecture source échouée : ${err.message}`);
  }
  try {
    targetMap = parseParity(await runPsql(targetUrl, sql));
  } catch (err) {
    throw new Error(`Lecture cible échouée : ${err.message}`);
  }

  const rows = tables.map((name) => {
    const source = sourceMap.get(name) ?? { count: "?", hash: "" };
    const target = targetMap.get(name) ?? { count: "?", hash: "" };
    const match = source.count === target.count && source.hash === target.hash;
    return { name, source, target, match };
  });

  const mismatches = rows.filter((r) => !r.match).map((r) => r.name);

  // Parité migrations Drizzle (best-effort : la table peut être dans le schéma drizzle).
  let migrations = null;
  try {
    const ms = parseParity(
      await runPsql(
        sourceUrl,
        "SELECT 'migrations' AS t, count(*)::text AS c, '' AS h FROM drizzle.__drizzle_migrations",
      ),
    ).get("migrations");
    const mt = parseParity(
      await runPsql(
        targetUrl,
        "SELECT 'migrations' AS t, count(*)::text AS c, '' AS h FROM drizzle.__drizzle_migrations",
      ),
    ).get("migrations");
    migrations = {
      source: ms?.count ?? "?",
      target: mt?.count ?? "?",
      match: ms?.count === mt?.count,
    };
    if (migrations && !migrations.match) mismatches.push("drizzle.__drizzle_migrations");
  } catch {
    migrations = null;
  }

  return {
    ok: mismatches.length === 0,
    tables: rows,
    migrations,
    mismatches,
  };
}

/** Rendu texte lisible du rapport (pour la console et le rapport md). */
export function formatParityReport(report) {
  const lines = [];
  for (const r of report.tables) {
    const flag = r.match ? "OK " : "DIFF";
    lines.push(
      `  [${flag}] ${r.name.padEnd(20)} source=${r.source.count.padStart(6)}  cible=${r.target.count.padStart(6)}` +
        (r.match ? "" : `  (hash source=${r.source.hash.slice(0, 8)} cible=${r.target.hash.slice(0, 8)})`),
    );
  }
  if (report.migrations) {
    const flag = report.migrations.match ? "OK " : "DIFF";
    lines.push(
      `  [${flag}] migrations           source=${report.migrations.source}  cible=${report.migrations.target}`,
    );
  } else {
    lines.push("  [--] migrations           (non vérifiées — schéma drizzle absent ?)");
  }
  return lines.join("\n");
}
