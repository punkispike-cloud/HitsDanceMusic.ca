#!/usr/bin/env node
/* Bascule l'API staging sur enondes_app sans logger de secrets.
 * Prérequis : TCP proxy Postgres-2fkU + rôle créé (setup-rls-role).
 * Usage (depuis la racine, env Railway CLI lié au projet) :
 *   node scripts/activate-enondes-app-staging.mjs
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";

function railway(args, opts = {}) {
  const r = spawnSync("railway", args, {
    encoding: "utf8",
    shell: true,
    ...opts,
  });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(r.stderr || r.stdout || "railway failed");
    process.exit(r.status ?? 1);
  }
  return r;
}

console.log("[activate] link staging…");
railway(["environment", "link", "staging"]);

const list = railway([
  "variable",
  "list",
  "--service",
  "Postgres-2fkU",
  "--json",
]);
const pgVars = JSON.parse(list.stdout);
const ownerInternal = pgVars.DATABASE_URL;
if (!ownerInternal) {
  console.error("Postgres-2fkU DATABASE_URL manquant");
  process.exit(1);
}

const host = String(pgVars.RAILWAY_TCP_PROXY_DOMAIN || "").replace(/\.$/, "");
const port = pgVars.RAILWAY_TCP_PROXY_PORT;
if (!host || !port) {
  console.error("TCP proxy absent sur Postgres-2fkU — impossible depuis la machine");
  process.exit(1);
}

const ownerPublic = new URL(ownerInternal);
ownerPublic.hostname = host;
ownerPublic.port = String(port);
const ownerUrl = ownerPublic.toString();

const pwd = randomBytes(24).toString("base64url");
const pool = new pg.Pool({
  connectionString: ownerUrl,
  ssl: { rejectUnauthorized: false },
});
const client = await pool.connect();
try {
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enondes_app') THEN
        CREATE ROLE enondes_app LOGIN NOBYPASSRLS;
      END IF;
    END $$;
  `);
  await client.query(`ALTER ROLE enondes_app WITH PASSWORD '${pwd.replace(/'/g, "''")}'`);
  await client.query("GRANT USAGE ON SCHEMA public TO enondes_app");
  await client.query(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO enondes_app",
  );
  await client.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO enondes_app");
  console.log("[activate] rôle enondes_app prêt");
} finally {
  client.release();
  await pool.end();
}

const appUrl = new URL(ownerUrl);
appUrl.username = "enondes_app";
appUrl.password = pwd;

// MIGRATE = owner (interne Railway pour le conteneur API)
console.log("[activate] set MIGRATE_DATABASE_URL (owner internal)…");
let r = spawnSync("railway", ["variable", "set", "--service", "patient-endurance", "--stdin", "MIGRATE_DATABASE_URL"], {
  encoding: "utf8",
  shell: true,
  input: ownerInternal,
});
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(1);
}

// DATABASE_URL runtime = enondes_app via proxy public hostname won't work inside Railway
// Conteneur API doit utiliser hostname interne + user enondes_app
const appInternal = new URL(ownerInternal);
appInternal.username = "enondes_app";
appInternal.password = pwd;

console.log("[activate] set DATABASE_URL (enondes_app internal)…");
r = spawnSync("railway", ["variable", "set", "--service", "patient-endurance", "--stdin", "DATABASE_URL"], {
  encoding: "utf8",
  shell: true,
  input: appInternal.toString(),
});
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(1);
}

console.log("[activate] variables posées — redeploy API déclenché par Railway");
console.log("[activate] ensuite : npm run verify:staging");
