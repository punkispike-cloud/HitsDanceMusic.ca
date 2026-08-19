/* Top titres — le SQL RÉEL de la route (topTracksQuery) + la fusion réelle
   (mergeTopTracks) s'exécutent sur un vrai moteur Postgres embarqué (PGlite),
   avec des métadonnées réellement observées à l'antenne (flux Hits Dance,
   août 2026) : jingles/liners, entités HTML, variantes « (Official Video) ».
   Une copie collée du filtre dériverait de la production ; ici, si quelqu'un
   modifie la requête ou les regex, c'est ça qui est testé. */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { topTracksQuery } from "../src/routes/analytics-admin.js";
import {
  mergeTopTracks,
  cleanTrackLabel,
  stripVideoSuffixes,
  type TopTrackRow,
} from "../src/services/track-labels.js";
import { closeDb } from "../src/db/client.js";

const dialect = new PgDialect();
let pg: PGlite;
let radioId: string;

async function runQuery(q: ReturnType<typeof topTracksQuery>) {
  const { sql, params } = dialect.sqlToQuery(q);
  return pg.query(sql, params as unknown[]);
}

async function addPlay(artist: string, title: string, opts: { likes?: number; daysAgo?: number } = {}) {
  const r = await pg.query<{ id: string }>(
    `INSERT INTO track_history (radio_id, artist, title, played_at)
     VALUES ($1, $2, $3, now() - ($4 || ' days')::interval) RETURNING id`,
    [radioId, artist, title, String(opts.daysAgo ?? 0)],
  );
  for (let i = 0; i < (opts.likes ?? 0); i++) {
    await pg.query(`INSERT INTO track_likes (radio_id, track_id) VALUES ($1, $2)`, [radioId, r.rows[0]!.id]);
  }
}

before(async () => {
  pg = new PGlite();
  // Schéma réduit aux colonnes touchées par la requête (cf. src/db/schema.ts).
  await pg.exec(`
    CREATE TABLE radios (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE track_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      radio_id uuid REFERENCES radios(id) ON DELETE CASCADE,
      artist text NOT NULL DEFAULT '',
      title text NOT NULL,
      played_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE track_likes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      radio_id uuid REFERENCES radios(id) ON DELETE CASCADE,
      track_id uuid NOT NULL
    );
    CREATE TABLE analytics_track_listen (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      radio_id uuid REFERENCES radios(id) ON DELETE CASCADE,
      day date NOT NULL,
      artist text NOT NULL DEFAULT '',
      title text NOT NULL,
      client_id text NOT NULL,
      listen_sec integer NOT NULL DEFAULT 0
    );
  `);
  const r = await pg.query<{ id: string }>(`INSERT INTO radios DEFAULT VALUES RETURNING id`);
  radioId = r.rows[0]!.id;

  // Un vrai hit : 2 variantes du même titre + likes + écoute mesurée.
  await addPlay("Ottagon feat. SGNLS", "Right Now (Official Visualizer)", { likes: 2 });
  await addPlay("Ottagon feat. SGNLS", "Right Now (Official Visualizer)");
  await addPlay("Ottagon feat. SGNLS", "Right Now [4K Video]", { likes: 1 });
  await pg.query(
    `INSERT INTO analytics_track_listen (radio_id, day, artist, title, client_id, listen_sec) VALUES
     ($1, now()::date, 'Ottagon feat. SGNLS', 'Right Now (Official Visualizer)', 'c1', 120),
     ($1, now()::date, 'Ottagon feat. SGNLS', 'Right Now (Official Visualizer)', 'c2', 60),
     ($1, now()::date, 'Ottagon feat. SGNLS', 'Right Now [4K Video]', 'c1', 30)`,
    [radioId],
  );
  // Entités HTML héritées de l'historique.
  await addPlay("Bootleg King Remix", "Don&apos;t Stop Believin&apos; (Cesar Vilo Remix)");
  // Jingles/liners réellement observés — à exclure.
  await addPlay("", "EN DIRECT!", { likes: 3 });
  await addPlay("HitsDanceMusic.ca", "24/7 LA RADIO DANCE MUSIC");
  await addPlay("BEAT RADIO WORLD", "LINK 1");
  // Pièges : de VRAIS titres qui ressemblent aux motifs exclus.
  await addPlay("T.I.", "Live Your Life");
  await addPlay("Artiste", "24/7");
  // Hors fenêtre : ne doit pas apparaître sur 30 jours.
  await addPlay("Vieux", "Titre Oublié", { daysAgo: 45 });
});

after(async () => {
  await pg?.close();
  await closeDb();
});

test("top-tracks bout-en-bout : jingles exclus, variantes fusionnées, écoute exacte", async () => {
  const res = await runQuery(topTracksQuery(radioId, 30));
  const out = mergeTopTracks(res.rows as TopTrackRow[]);
  const titles = out.map((t) => t.title);

  // Jingles/liners absents ; vrais titres pièges présents.
  assert.ok(!titles.includes("EN DIRECT!"));
  assert.ok(!titles.some((t) => t.includes("24/7 LA RADIO")));
  assert.ok(!titles.includes("LINK 1"));
  assert.ok(titles.includes("Live Your Life"), "« Live Your Life » n'est pas un liner");
  assert.ok(titles.includes("24/7"), "un vrai titre « 24/7 » survit");
  assert.ok(!titles.includes("Titre Oublié"), "hors fenêtre de 30 jours");

  // Variantes fusionnées sous le libellé nettoyé, compteurs exacts.
  const hit = out.find((t) => t.title === "Right Now");
  assert.ok(hit, "les 2 variantes se rejoignent sous « Right Now »");
  assert.equal(hit.playCount, 3, "passages additionnés entre variantes");
  assert.equal(hit.likeCount, 3, "likes additionnés entre variantes");
  assert.equal(hit.listenSec, 210, "secondes d'écoute additionnées (120+60+30)");
  assert.equal(hit.listeners, 2, "auditeurs : MAX des variantes (c1 écoute les deux)");

  // Entités décodées à la lecture (historique legacy).
  assert.ok(titles.includes("Don't Stop Believin' (Cesar Vilo Remix)"));

  // Un titre jamais mesuré reste null (affiché « — »), pas 0.
  const noData = out.find((t) => t.title === "Live Your Life");
  assert.equal(noData!.listenSec, null);
});

test("cleanTrackLabel : entités décodées, suffixes vidéo retirés, remixes gardés", () => {
  assert.equal(cleanTrackLabel("Don&apos;t Stop Believin&apos; (Cesar Vilo Remix)"), "Don't Stop Believin' (Cesar Vilo Remix)");
  assert.equal(cleanTrackLabel("Ameonna [Official 4K Visualizer]"), "Ameonna");
  assert.equal(cleanTrackLabel("All This Time [Official Lyric Video]"), "All This Time");
  assert.equal(
    cleanTrackLabel("Giant (Robin Schulz Remix) [Audio]"),
    "Giant (Robin Schulz Remix)",
    "la mention remix survit, le segment vidéo tombe",
  );
  assert.equal(stripVideoSuffixes("World Hold On (Spice Mega Mashup)"), "World Hold On (Spice Mega Mashup)");
});
