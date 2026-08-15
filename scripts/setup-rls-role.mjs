#!/usr/bin/env node
/* Crée/aligne le rôle enondes_app sur une base puis lance api/scripts/test-rls.mjs.
 * Usage (depuis la racine du dépôt) :
 *   node scripts/setup-rls-role.mjs <DATABASE_PUBLIC_URL>
 * N'affiche jamais le mot de passe.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.argv[2];
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error("Usage: node scripts/setup-rls-role.mjs <DATABASE_PUBLIC_URL>");
  process.exit(1);
}

const pwd = randomBytes(24).toString("base64url");
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
try {
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enondes_app') THEN
        CREATE ROLE enondes_app LOGIN NOBYPASSRLS;
      END IF;
    END $$;
  `);
  // ALTER ROLE ... PASSWORD n'accepte pas de paramètres liés ($1).
  await client.query(`ALTER ROLE enondes_app WITH PASSWORD '${pwd.replace(/'/g, "''")}'`);
  await client.query("GRANT USAGE ON SCHEMA public TO enondes_app");
  await client.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO enondes_app");
  await client.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO enondes_app");
  await client.query(
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO enondes_app",
  );
  console.log("[setup-rls] rôle enondes_app prêt");
} finally {
  client.release();
  await pool.end();
}

const appUrl = new URL(url);
appUrl.username = "enondes_app";
appUrl.password = pwd;

const r = spawnSync(process.execPath, ["api/scripts/test-rls.mjs"], {
  cwd: root,
  env: { ...process.env, DATABASE_URL: url, RLS_TEST_URL: appUrl.toString() },
  encoding: "utf8",
});
process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
process.exit(r.status ?? 1);
