/* Seed de pistes de DÉMONSTRATION dans le catalogue à la demande.
   Pistes instrumentales SoundHelix (libres pour tests/démo), URLs HTTPS stables
   lisibles en cross-origin par un <audio>. Idempotent (skip si titre déjà présent).
   Rattache à la 1re radio (ou NEW_RADIO_SLUG). À supprimer ensuite via l'admin.

   Lancer : railway run --service patient-endurance node scripts/seed-demo-tracks.mjs
   ou avec DATABASE_URL (URL publique) exporté. */

import pg from "pg";
import { resolveDbSsl } from "./lib/db-ssl.mjs";

const DEMO = [
  { artist: "SoundHelix", title: "Deep Horizon", genre: "Électronique", dur: 372, n: 1 },
  { artist: "SoundHelix", title: "Night Circuit", genre: "Électronique", dur: 427, n: 2 },
  { artist: "SoundHelix", title: "Golden Hour", genre: "Ambient", dur: 350, n: 3 },
  { artist: "SoundHelix", title: "Pulse Theory", genre: "Dance", dur: 300, n: 4 },
  { artist: "SoundHelix", title: "Neon Drift", genre: "Dance", dur: 295, n: 5 },
  { artist: "SoundHelix", title: "Afterglow", genre: "Ambient", dur: 384, n: 6 },
  { artist: "SoundHelix", title: "Momentum", genre: "Rock", dur: 421, n: 7 },
  { artist: "SoundHelix", title: "Skyline", genre: "Rock", dur: 306, n: 8 },
];

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL absent (lancer via railway run ou exporter l'URL publique)."); process.exit(1); }

const pool = new pg.Pool({
  connectionString: url,
  ssl: resolveDbSsl(url),
});

try {
  const slug = (process.env.NEW_RADIO_SLUG || "").trim();
  let radioId = null;
  if (slug) {
    const r = await pool.query("SELECT id FROM radios WHERE slug = $1 LIMIT 1", [slug]);
    radioId = r.rows[0]?.id ?? null;
  }
  if (!radioId) {
    const r = await pool.query("SELECT id, slug FROM radios ORDER BY created_at ASC LIMIT 1");
    if (!r.rows[0]) { console.error("Aucune radio en base."); process.exit(1); }
    radioId = r.rows[0].id;
    console.log(`[demo] radio : ${r.rows[0].slug}`);
  }

  let created = 0;
  for (const t of DEMO) {
    const exists = await pool.query("SELECT id FROM tracks WHERE title = $1 AND artist = $2 LIMIT 1", [t.title, t.artist]);
    if (exists.rows[0]) { console.log(`[demo] skip (existe) : ${t.title}`); continue; }
    const audioUrl = `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${t.n}.mp3`;
    await pool.query(
      `INSERT INTO tracks (radio_id, artist, title, genre, duration_sec, audio_url, source, license, status)
       VALUES ($1,$2,$3,$4,$5,$6,'SoundHelix','Démo (test)','published')`,
      [radioId, t.artist, t.title, t.genre, t.dur, audioUrl],
    );
    created++;
    console.log(`[demo] créé : ${t.title}`);
  }
  console.log(`[demo] terminé — ${created} piste(s) ajoutée(s).`);
} finally {
  await pool.end();
}
