/* Le garde des migrations doit virer au rouge sur une migration destructive
   sans chemin de retour — et rester vert sur le dépôt réel.

   Il tourne sur des FIXTURES via MIGRATIONS_DIR : prouver qu'il échoue en
   salissant les vraies migrations laisserait le dépôt dans un état douteux si
   le test s'interrompait. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = join("api", "scripts", "check-migrations.mjs");

function runGuard(migrationsDir) {
  return spawnSync(process.execPath, [GUARD], {
    cwd: root,
    encoding: "utf8",
    env: migrationsDir ? { ...process.env, MIGRATIONS_DIR: migrationsDir } : process.env,
  });
}

async function fixture(files) {
  const dir = await mkdtemp(join(tmpdir(), "migr-guard-"));
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body, "utf-8");
  }
  return dir;
}

test("dépôt réel : aucune migration destructive → vert", () => {
  const r = runGuard(null);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("migration destructive sans down/ → rouge", async (t) => {
  const dir = await fixture({
    "0001_init.sql": `CREATE TABLE "shows" ("id" uuid PRIMARY KEY);`,
    "0002_purge.sql": `ALTER TABLE "shows" DROP COLUMN "legacy_slug";`,
  });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const r = runGuard(dir);
  assert.equal(r.status, 1, "le garde a laissé passer un DROP COLUMN sans rollback");
  assert.match(r.stderr, /0002_purge\.sql/);
  assert.match(r.stderr, /DROP COLUMN/);
});

test("la même migration avec son down/ → vert", async (t) => {
  const dir = await fixture({
    "0001_init.sql": `CREATE TABLE "shows" ("id" uuid PRIMARY KEY);`,
    "0002_purge.sql": `ALTER TABLE "shows" DROP COLUMN "legacy_slug";`,
    "down/0002_purge.sql": `ALTER TABLE "shows" ADD COLUMN "legacy_slug" text;`,
  });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const r = runGuard(dir);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("un DROP INDEX n'est pas traité comme destructif", async (t) => {
  /* 0009 supprime sept index pour les recréer portés sur (radio_id, slug). Un
     index se reconstruit depuis le schéma, aucune donnée n'est en jeu : le
     compter comme destructif rendrait le garde rouge dès sa naissance — et un
     garde qui naît rouge est un garde qu'on apprend à ignorer. */
  const dir = await fixture({
    "0001_reindex.sql": `DROP INDEX IF EXISTS "shows_slug_idx";
CREATE UNIQUE INDEX "shows_slug_idx" ON "shows" ("radio_id","slug");`,
  });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const r = runGuard(dir);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("un DROP mentionné en commentaire ne déclenche rien", async (t) => {
  const dir = await fixture({
    "0001_safe.sql": `-- on ne DROP TABLE jamais ici, on ajoute seulement
ALTER TABLE "shows" ADD COLUMN "tagline" text;`,
  });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const r = runGuard(dir);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
