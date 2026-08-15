/* Ingestion analytics — exécutée sur un vrai moteur Postgres embarqué (PGlite,
   WASM : aucun service à lancer, aucune connexion réseau).

   Ce test rejoue le SQL RÉEL de src/services/analytics.ts : il importe les
   constructeurs de requêtes (sessionUpsertQuery / dailyUpsertQuery) et les rend
   avec le dialecte Drizzle, exactement comme le fait `db.execute`. Une copie
   collée du SQL dériverait de la production ; ici, si quelqu'un modifie la
   requête, c'est cette requête-là qui est testée.

   Ce qu'on protège :
   - le plafonnement au temps réellement écoulé (deux fenêtres ouvertes en
     parallèle partagent un client_id et comptaient le temps en double) ;
   - le fait que l'écoute ne soit pas « mangée » par le heartbeat d'une autre
     fenêtre (d'où last_active_at ET last_listen_at) ;
   - la cohérence entre le compteur « visiteurs aujourd'hui » et la première
     barre de la série quotidienne (même table, même fuseau). */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { sessionUpsertQuery, dailyUpsertQuery } from "../src/services/analytics.js";

const RADIO_TZ = "America/Toronto";
const dialect = new PgDialect();

let pg: PGlite;
let radioId: string;

/** Exécute un objet SQL Drizzle sur PGlite (même rendu que db.execute). */
async function run(query: ReturnType<typeof dailyUpsertQuery>) {
  const { sql, params } = dialect.sqlToQuery(query);
  return pg.query(sql, params as unknown[]);
}

/** Un beacon complet : upsert de session plafonné + ventilation du jour. */
async function ingest(clientId: string, type: "pageview" | "heartbeat" | "listen", seconds = 0) {
  const activeReq = type === "heartbeat" || type === "listen" ? Math.min(seconds, 60) : 0;
  const listenReq = type === "listen" ? Math.min(seconds, 60) : 0;
  const pageAdd = type === "pageview" ? 1 : 0;

  const res = await run(
    sessionUpsertQuery({
      radioId,
      clientId,
      ip: "1.2.3.4",
      userAgent: "UA",
      browser: "Chrome",
      device: "Ordinateur",
      activeReq,
      listenReq,
      pageAdd,
    }),
  );
  const { activeAdd, listenAdd } = res.rows[0] as { activeAdd: number; listenAdd: number };
  await run(
    dailyUpsertQuery({
      radioId,
      clientId,
      activeAdd: Number(activeAdd),
      listenAdd: Number(listenAdd),
      pageAdd,
    }),
  );
  return { activeAdd: Number(activeAdd), listenAdd: Number(listenAdd) };
}

/** Simule « N secondes plus tard » en reculant les repères, sans attendre. */
async function rewind(clientId: string, sec: number) {
  await pg.query(
    `UPDATE analytics_sessions
        SET first_seen = first_seen - ($3 || ' seconds')::interval,
            last_seen = last_seen - ($3 || ' seconds')::interval,
            last_active_at = last_active_at - ($3 || ' seconds')::interval,
            last_listen_at = last_listen_at - ($3 || ' seconds')::interval
      WHERE radio_id = $1 AND client_id = $2`,
    [radioId, clientId, String(sec)],
  );
}

async function session(clientId: string) {
  const r = await pg.query<{ active_sec: number; listen_sec: number }>(
    `SELECT active_sec, listen_sec FROM analytics_sessions WHERE radio_id = $1 AND client_id = $2`,
    [radioId, clientId],
  );
  return r.rows[0]!;
}

before(async () => {
  pg = new PGlite();
  // Schéma réduit aux colonnes touchées par l'ingestion (cf. src/db/schema.ts).
  await pg.exec(`
    CREATE TABLE radios (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE analytics_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      radio_id uuid REFERENCES radios(id) ON DELETE CASCADE,
      client_id text NOT NULL,
      ip text, ip_country text, ip_lat double precision, ip_lon double precision,
      user_agent text, device text, browser text,
      first_seen timestamptz NOT NULL DEFAULT now(),
      last_seen timestamptz NOT NULL DEFAULT now(),
      last_active_at timestamptz,
      last_listen_at timestamptz,
      active_sec integer NOT NULL DEFAULT 0,
      listen_sec integer NOT NULL DEFAULT 0,
      page_views integer NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX analytics_sessions_client_idx ON analytics_sessions (radio_id, client_id);
    CREATE TABLE analytics_daily (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      radio_id uuid REFERENCES radios(id) ON DELETE CASCADE,
      day date NOT NULL,
      client_id text NOT NULL,
      active_sec integer NOT NULL DEFAULT 0,
      listen_sec integer NOT NULL DEFAULT 0,
      page_views integer NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX analytics_daily_day_client_idx ON analytics_daily (radio_id, day, client_id);
  `);
  const r = await pg.query<{ id: string }>(`INSERT INTO radios DEFAULT VALUES RETURNING id`);
  radioId = r.rows[0]!.id;
});

after(async () => {
  await pg?.close();
});

test("un seul onglet : tout le temps réellement écoulé est crédité", async () => {
  await ingest("solo", "pageview");
  for (let i = 0; i < 3; i++) {
    await rewind("solo", 20);
    await ingest("solo", "heartbeat", 20);
  }
  assert.equal((await session("solo")).active_sec, 60);
});

test("deux fenêtres : le temps n'est pas compté en double", async () => {
  await ingest("twowin", "pageview");
  for (let i = 0; i < 3; i++) {
    await rewind("twowin", 20);
    await ingest("twowin", "heartbeat", 20); // fenêtre 1
    await ingest("twowin", "heartbeat", 20); // fenêtre 2, même instant
  }
  // 6 beacons de 20 s pour 60 s réellement écoulées → 60 s, pas 120.
  assert.equal((await session("twowin")).active_sec, 60);
});

test("l'écoute survit au heartbeat d'une fenêtre voisine", async () => {
  await ingest("mixed", "pageview");
  for (let i = 0; i < 3; i++) {
    await rewind("mixed", 20);
    await ingest("mixed", "heartbeat", 20); // fenêtre inactive
    await ingest("mixed", "listen", 20); // fenêtre qui joue
  }
  const s = await session("mixed");
  assert.equal(s.listen_sec, 60, "temps d'écoute intact");
  assert.equal(s.active_sec, 60, "temps sur le site plafonné au temps réel");
});

test("un beacon exagéré est ramené au temps écoulé", async () => {
  await ingest("liar", "pageview");
  await rewind("liar", 5);
  const { activeAdd } = await ingest("liar", "heartbeat", 60); // annonce 60 s, 5 s réelles
  assert.equal(activeAdd, 5);
});

test("« visiteurs aujourd'hui » = dernière barre de la série quotidienne", async () => {
  const today = await pg.query<{ today: number }>(
    `SELECT count(*)::int AS today FROM analytics_daily
      WHERE radio_id = $1 AND day = (now() AT TIME ZONE 'America/Toronto')::date`,
    [radioId],
  );
  const series = await pg.query<{ sessions: number }>(
    `SELECT count(a.id)::int AS sessions
       FROM generate_series((now() AT TIME ZONE '${RADIO_TZ}')::date - (29 || ' days')::interval,
                            (now() AT TIME ZONE '${RADIO_TZ}')::date, interval '1 day') d
       LEFT JOIN analytics_daily a ON a.day = d::date AND a.radio_id = $1
      GROUP BY d ORDER BY d`,
    [radioId],
  );
  assert.equal(series.rows.length, 30, "30 jours, trous compris");
  assert.equal(today.rows[0]!.today, series.rows.at(-1)!.sessions);
});

test("reprise d'historique : rejouable sans doubler les compteurs", async () => {
  // Une session ancienne, comme il en existe en production avant la migration.
  await pg.query(
    `INSERT INTO analytics_sessions (radio_id, client_id, first_seen, last_seen, active_sec, listen_sec, page_views)
     VALUES ($1, 'vieux', now() - interval '10 days', now() - interval '1 day', 3600, 3000, 12)`,
    [radioId],
  );
  const backfill = `
    INSERT INTO analytics_daily (radio_id, day, client_id, active_sec, listen_sec, page_views)
    SELECT s.radio_id, (s.first_seen AT TIME ZONE '${RADIO_TZ}')::date, s.client_id,
           s.active_sec, s.listen_sec, s.page_views
      FROM analytics_sessions s WHERE s.radio_id IS NOT NULL
    ON CONFLICT (radio_id, day, client_id) DO NOTHING
    RETURNING client_id`;

  const first = await pg.query<{ client_id: string }>(backfill);
  assert.deepEqual(
    first.rows.map((r) => r.client_id),
    ["vieux"],
    "seules les lignes manquantes sont créées",
  );
  const second = await pg.query<{ client_id: string }>(backfill);
  assert.equal(second.rows.length, 0, "un second passage n'ajoute rien");
});
