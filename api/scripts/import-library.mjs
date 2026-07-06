/* Import EN MASSE d'une banque de musique locale vers le catalogue à la demande.
   - Parcourt un dossier (récursif) de .mp3 (et autres formats audio).
   - artiste/titre = nom de fichier « Artiste - Titre » ; genre = sous-dossier ;
     durée = ffprobe. Téléverse chaque fichier sur R2/S3, insère une piste
     (status published). Idempotent : skip si (artiste,titre) déjà présent.

   Prérequis (variables d'environnement) :
     DATABASE_URL           base Postgres (URL publique Railway pour un run local)
     S3_ENDPOINT            R2 : https://<accountid>.r2.cloudflarestorage.com
     S3_REGION              R2 : "auto"
     S3_BUCKET              nom du bucket
     S3_ACCESS_KEY_ID       clé R2
     S3_SECRET_ACCESS_KEY   secret R2
     S3_PUBLIC_BASE_URL     URL publique du bucket (r2.dev ou domaine perso)
     S3_FORCE_PATH_STYLE    "true" pour R2
   Optionnel :
     MUSIC_DIR              dossier source (défaut : ce qui est passé en argv[2])
     IMPORT_LICENSE         libellé licence (défaut "Licence directe")
     IMPORT_RADIO_SLUG      radio de rattachement (défaut : 1re radio)
     DRY_RUN=1              analyse sans téléverser ni insérer

   Lancer :  node scripts/import-library.mjs "C:\\Users\\kapten\\Music\\banque-radio" */

import { readdir, stat, readFile } from "node:fs/promises";
import { join, extname, basename, relative, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const execFileP = promisify(execFile);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".aac", ".ogg", ".wav", ".flac"]);
const CONTENT_TYPE = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".wav": "audio/wav", ".flac": "audio/flac" };
const GENRE_MAP = { "_bases-dj": "Bases DJ", "Divers": null };

const MUSIC_DIR = process.env.MUSIC_DIR || process.argv[2];
const DRY = process.env.DRY_RUN === "1";
const LICENSE = process.env.IMPORT_LICENSE || "Licence directe";

if (!MUSIC_DIR) { console.error("Usage: node scripts/import-library.mjs <dossier>"); process.exit(1); }

function req(name) {
  const v = process.env[name];
  if (!v && !DRY) { console.error(`❌ variable requise manquante : ${name}`); process.exit(1); }
  return v;
}
const DATABASE_URL = req("DATABASE_URL");
const S3_ENDPOINT = req("S3_ENDPOINT");
const S3_BUCKET = req("S3_BUCKET");
const S3_PUBLIC = (req("S3_PUBLIC_BASE_URL") || "").replace(/\/$/, "");

const s3 = DRY ? null : new S3Client({
  region: process.env.S3_REGION || "auto",
  endpoint: S3_ENDPOINT,
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "true") === "true",
  credentials: { accessKeyId: req("S3_ACCESS_KEY_ID"), secretAccessKey: req("S3_SECRET_ACCESS_KEY") },
});
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: /railway|amazonaws|proxy\.rlwy/i.test(DATABASE_URL || "") ? { rejectUnauthorized: false } : undefined,
});

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    const s = await stat(p);
    if (s.isDirectory()) out.push(...(await walk(p)));
    else if (AUDIO_EXT.has(extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

function parseName(file) {
  const base = basename(file, extname(file)).replace(/_/g, " ").trim();
  const idx = base.indexOf(" - ");
  if (idx > 0) return { artist: base.slice(0, idx).trim(), title: base.slice(idx + 3).trim() };
  return { artist: "Artiste inconnu", title: base };
}

function genreFor(file) {
  const rel = relative(MUSIC_DIR, file);
  const top = rel.split(/[\\/]/)[0];
  if (top === basename(file)) return null; // fichier à la racine
  if (top in GENRE_MAP) return GENRE_MAP[top];
  return top.replace(/^_+/, "").trim() || null;
}

async function durationSec(file) {
  try {
    const { stdout } = await execFileP("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    const d = Math.round(parseFloat(stdout.trim()));
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch { return null; }
}

async function main() {
  console.log(`[import] dossier : ${MUSIC_DIR}${DRY ? "  (DRY RUN)" : ""}`);
  const files = await walk(MUSIC_DIR);
  console.log(`[import] ${files.length} fichiers audio détectés.`);

  let radioId = null;
  if (!DRY) {
    const slug = (process.env.IMPORT_RADIO_SLUG || "").trim();
    if (slug) radioId = (await pool.query("SELECT id FROM radios WHERE slug=$1 LIMIT 1", [slug])).rows[0]?.id ?? null;
    if (!radioId) {
      const r = await pool.query("SELECT id, slug FROM radios ORDER BY created_at ASC LIMIT 1");
      if (!r.rows[0]) { console.error("Aucune radio en base."); process.exit(1); }
      radioId = r.rows[0].id;
      console.log(`[import] radio : ${r.rows[0].slug}`);
    }
  }

  let created = 0, skipped = 0, failed = 0;
  for (const [i, file] of files.entries()) {
    const { artist, title } = parseName(file);
    const genre = genreFor(file);
    const tag = `[${i + 1}/${files.length}]`;
    try {
      if (!DRY) {
        const exists = await pool.query("SELECT id FROM tracks WHERE lower(title)=lower($1) AND lower(artist)=lower($2) LIMIT 1", [title, artist]);
        if (exists.rows[0]) { skipped++; console.log(`${tag} skip (existe) : ${artist} — ${title}`); continue; }
      }
      const dur = await durationSec(file);
      if (DRY) { console.log(`${tag} ${artist} — ${title}  [${genre ?? "—"}] ${dur ?? "?"}s`); created++; continue; }

      const ext = extname(file).toLowerCase();
      const key = `tracks/${randomUUID()}${ext}`;
      const body = await readFile(file);
      await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET, Key: key, Body: body,
        ContentType: CONTENT_TYPE[ext] || "application/octet-stream",
      }));
      const audioUrl = `${S3_PUBLIC}/${key}`;
      await pool.query(
        `INSERT INTO tracks (radio_id, artist, title, genre, duration_sec, audio_url, audio_key, size_bytes, source, license, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Banque En Ondes',$9,'published')`,
        [radioId, artist, title, genre, dur, audioUrl, key, body.length, LICENSE],
      );
      created++;
      console.log(`${tag} ✓ ${artist} — ${title}  [${genre ?? "—"}]`);
    } catch (e) {
      failed++;
      console.error(`${tag} ✗ ${artist} — ${title} : ${e.message}`);
    }
  }
  console.log(`[import] terminé — ${created} créées, ${skipped} ignorées, ${failed} échecs.`);
  await pool.end().catch(() => {});
}

main().catch(async (e) => { console.error("[import] échec", e); await pool.end().catch(() => {}); process.exit(1); });
