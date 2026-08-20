#!/usr/bin/env node
/* En Ondes — Backup Postgres automatisé (audit 2026-08-16, G1).
 *
 * pg_dump (format custom) → validation de l'archive (pg_restore --list) →
 * upload S3/R2 → purge des backups plus vieux que BACKUP_RETENTION_DAYS.
 * Pensé pour tourner en CI planifiée (.github/workflows/backup.yml) ou à la
 * main. Nécessite `pg_dump` et `pg_restore` sur le PATH (paquet
 * postgresql-client).
 *
 * Variables d'environnement :
 *   BACKUP_DATABASE_URL   (requis) connexion à la base à sauvegarder
 *                          (DATABASE_PUBLIC_URL prod). Repli : DATABASE_URL.
 *   S3_ENDPOINT           endpoint S3 custom (R2 : https://<account>.r2.cloudflarestorage.com)
 *   S3_REGION             (défaut "auto" — R2)
 *   S3_BUCKET             (requis sauf si BACKUP_DIR) bucket de destination
 *   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY   (requis sauf si BACKUP_DIR)
 *   S3_FORCE_PATH_STYLE   (défaut "true" — R2 préfère le path-style)
 *   S3_PREFIX             (défaut "postgres/") préfixe des objets backup
 *   BACKUP_RETENTION_DAYS (défaut 30) purge des objets plus vieux
 *   BACKUP_DIR            (optionnel) si posé : écrit le dump localement dans
 *                          ce dossier et saute l'upload S3 (run manuel)
 *
 * SSL : même politique que le reste des scripts ops (scripts/lib/db-ssl.mjs) —
 * strict par défaut, pinning via DATABASE_CA_CERT, opt-out DB_SSL_INSECURE=1.
 *
 * Sortie : exit 0 si dump + validation + upload OK, 1 sinon. Le job CI rouge
 * est le signal d'alerte (pas de notification externe).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, stat, mkdir, writeFile, rm } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { resolveDbSsl } from "./lib/db-ssl.mjs";

const execFileAsync = promisify(execFile);

const databaseUrl = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL || "";
const backupDir = (process.env.BACKUP_DIR || "").trim();
const retentionDays = Math.max(1, parseInt(process.env.BACKUP_RETENTION_DAYS || "30", 10));
const s3Prefix = (process.env.S3_PREFIX || "postgres/").replace(/\/*$/, "/");

const log = (msg) => console.log(`[backup-db] ${msg}`);
const fail = (msg) => {
  console.error(`[backup-db] ECHEC : ${msg}`);
  process.exit(1);
};

if (!databaseUrl) {
  fail("BACKUP_DATABASE_URL (ou DATABASE_URL) requis — viser l'URL publique de la base prod.");
}

function setSslMode(url, mode) {
  if (/[?&]sslmode=/.test(url)) return url.replace(/sslmode=[^&]*/, `sslmode=${mode}`);
  return url + (url.includes("?") ? "&" : "?") + `sslmode=${mode}`;
}

const useS3 = !backupDir;
let s3 = null;
if (useS3) {
  const { S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    fail("S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY requis (ou BACKUP_DIR pour un run local).");
  }
  s3 = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "true") === "true",
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
  });
}

async function assertBinary(name) {
  try {
    await execFileAsync(name, ["--version"]);
  } catch {
    throw new Error(`binaire '${name}' introuvable sur le PATH (installer postgresql-client).`);
  }
}

async function run(label, bin, args) {
  const t0 = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      maxBuffer: 64 * 1024 * 1024,
      env: process.env,
    });
    if (stderr && stderr.trim()) process.stderr.write(`  (${label}) ${stderr.trim()}\n`);
    return { ms: Date.now() - t0, stdout };
  } catch (err) {
    throw new Error(`${label} : ${err.message}`);
  }
}

// --- Préflight -------------------------------------------------------------
try {
  await Promise.all([assertBinary("pg_dump"), assertBinary("pg_restore")]);
} catch (err) {
  fail(err.message);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const fileName = `backup-${stamp}.dump`;
const workDir = backupDir || (await mkdtemp(join(tmpdir(), "backup-db-")));
if (backupDir) await mkdir(backupDir, { recursive: true });
const dumpFile = join(workDir, fileName);

// --- SSL : traduire la politique resolveDbSsl pour libpq (pg_dump) ----------
// node-postgres vérifie la CA par défaut ; libpq avec sslmode=require chiffre
// SANS vérifier la CA. On mappe donc : CA posé → verify-ca + PGSSLROOTCERT
// (pinning) ; strict sans CA → verify-full + store système Linux s'il existe ;
// DB_SSL_INSECURE=1 → require inchangé (avertissement déjà émis).
//
// Pourquoi verify-ca et pas verify-full quand la CA est posée : le certificat
// généré par le template postgres-ssl de Railway porte CN=localhost et
// SAN=DNS:localhost uniquement, alors qu'on l'atteint par le proxy TCP
// (<sous-domaine>.proxy.rlwy.net). verify-full échouerait donc toujours sur la
// comparaison du nom d'hôte — « server certificate for "localhost" does not
// match host name ». verify-ca garde le pinning de la CA (le lien est chiffré et
// l'autorité vérifiée), seule la vérification du nom d'hôte est abandonnée.
let dumpUrl = databaseUrl;
try {
  const ssl = resolveDbSsl(databaseUrl);
  if (ssl?.ca) {
    const caPath = join(workDir, "db-ca.pem");
    await writeFile(caPath, ssl.ca);
    process.env.PGSSLROOTCERT = caPath;
    dumpUrl = setSslMode(dumpUrl, "verify-ca");
    log("SSL : pinning CA (verify-ca).");
  } else if (ssl?.rejectUnauthorized) {
    const systemStore = "/etc/ssl/certs/ca-certificates.crt";
    if (existsSync(systemStore)) {
      process.env.PGSSLROOTCERT = systemStore;
      dumpUrl = setSslMode(dumpUrl, "verify-full");
      log("SSL : vérification stricte via le store système (verify-full).");
    } else {
      console.warn(
        "[backup-db] pas de store CA système détecté — sslmode=require conservé " +
          "(chiffré, CA non vérifiée). Poser DATABASE_CA_CERT pour le pinning.",
      );
    }
  }
} catch (err) {
  fail(`configuration SSL invalide : ${err.message}`);
}

// --- Dump ------------------------------------------------------------------
let dumpMs;
try {
  log(`dump de ${databaseUrl.replace(/\/\/[^@]*@/, "//***@")} → ${fileName}...`);
  ({ ms: dumpMs } = await run("pg_dump", "pg_dump", [dumpUrl, "-Fc", "-f", dumpFile]));

  const { size } = await stat(dumpFile);
  if (size < 1024) throw new Error(`dump anormalement petit (${size} o) — base vide ou dump incomplet ?`);
  log(`dump ok : ${(size / 1024 / 1024).toFixed(1)} Mo en ${(dumpMs / 1000).toFixed(1)} s`);

  // --- Validation de l'archive (intégrité lisible par pg_restore) ----------
  await run("pg_restore --list", "pg_restore", ["--list", dumpFile]);
  log("archive valide (pg_restore --list OK)");
} catch (err) {
  fail(err.message);
}

// --- Destination : S3 ou dossier local --------------------------------------
if (!useS3) {
  log(`BACKUP_DIR posé — copie locale conservée : ${dumpFile}`);
  log("backup réussi (local, pas d'upload S3).");
  process.exit(0);
}

const objectKey = `${s3Prefix}${fileName}`;
try {
  log(`upload → s3://${process.env.S3_BUCKET}/${objectKey}...`);
  const t0 = Date.now();
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: objectKey,
      Body: createReadStream(dumpFile),
      ContentType: "application/octet-stream",
    }),
  );
  log(`upload ok en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (err) {
  fail(`upload S3 : ${err.message}`);
}

// --- Purge des backups expirés ----------------------------------------------
const cutoff = Date.now() - retentionDays * 86_400_000;
let listed;
try {
  listed = await s3.send(
    new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: s3Prefix }),
  );
} catch (err) {
  // L'upload du jour est fait — une purge en échec ne doit pas faire échouer
  // le backup (certains comptes R2 restreignent List). On avertit seulement.
  console.warn(`[backup-db] purge sautée (list impossible : ${err.message})`);
  listed = null;
}
if (listed) {
  const expired = (listed.Contents || []).filter(
    (o) => o.Key?.endsWith(".dump") && o.LastModified && o.LastModified.getTime() < cutoff,
  );
  for (const o of expired) {
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: o.Key }));
    log(`purgé : ${o.Key}`);
  }
  log(`rétention ${retentionDays} j : ${expired.length} backup(s) purgé(s), ${(listed.Contents || []).length - expired.length} conservé(s).`);
}

// Nettoyage du dossier temporaire (sauf run local BACKUP_DIR, conservé).
if (!backupDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});

log("backup réussi.");
process.exit(0);
