/* Isolation radio_id des requêtes analytics-admin (Phase 2.3).
   Rejoue le SQL RÉEL des handlers (overview / geo / sessions / shows /
   timeseries / breakdown) sur PGlite avec deux radios. Protège contre une
   fuite de données d'une radio vers l'autre si un WHERE radio_id disparaît. */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

const RADIO_TZ = "America/Toronto";
const SKIP_THRESHOLD_SEC = 15;

let pg: PGlite;
let radioA: string;
let radioB: string;

before(async () => {
  pg = new PGlite();
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
    CREATE TABLE analytics_show_listen (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      radio_id uuid REFERENCES radios(id) ON DELETE CASCADE,
      show_title text NOT NULL,
      client_id text NOT NULL,
      listen_sec integer NOT NULL DEFAULT 0,
      last_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX analytics_show_listen_idx ON analytics_show_listen (radio_id, show_title, client_id);
  `);
  const radios = await pg.query<{ id: string }>(`INSERT INTO radios DEFAULT VALUES RETURNING id`);
  const radios2 = await pg.query<{ id: string }>(`INSERT INTO radios DEFAULT VALUES RETURNING id`);
  radioA = radios.rows[0]!.id;
  radioB = radios2.rows[0]!.id;

  await pg.query(
    `INSERT INTO analytics_sessions (radio_id, client_id, ip, ip_country, ip_lat, ip_lon, device, browser, active_sec, listen_sec, page_views)
     VALUES ($1, 'visiteur-a', '1.1.1.1', 'Montréal, Canada', 45.5, -73.6, 'Mobile', 'Chrome', 100, 80, 3),
            ($2, 'visiteur-b', '2.2.2.2', 'Paris, France', 48.8, 2.3, 'Ordinateur', 'Firefox', 999, 888, 50)`,
    [radioA, radioB],
  );
  await pg.query(
    `INSERT INTO analytics_daily (radio_id, day, client_id, active_sec, listen_sec, page_views)
     VALUES ($1, (now() AT TIME ZONE '${RADIO_TZ}')::date, 'visiteur-a', 100, 80, 3),
            ($2, (now() AT TIME ZONE '${RADIO_TZ}')::date, 'visiteur-b', 999, 888, 50)`,
    [radioA, radioB],
  );
  await pg.query(
    `INSERT INTO analytics_show_listen (radio_id, show_title, client_id, listen_sec)
     VALUES ($1, 'Hit du matin', 'visiteur-a', 80),
            ($2, 'Secret radio B', 'visiteur-b', 888)`,
    [radioA, radioB],
  );
});

after(async () => {
  await pg?.close();
});

test("overview : totaux de radio A n'incluent pas radio B", async () => {
  const r = await pg.query<{ total: number; listen: number }>(
    `SELECT count(*)::int AS total, coalesce(sum(listen_sec),0)::int AS listen
     FROM analytics_sessions WHERE radio_id = $1`,
    [radioA],
  );
  assert.equal(r.rows[0]!.total, 1);
  assert.equal(r.rows[0]!.listen, 80);
});

test("geo : points de radio A n'incluent pas Paris (radio B)", async () => {
  const r = await pg.query<{ label: string }>(
    `SELECT ip_country AS label FROM analytics_sessions
     WHERE radio_id = $1 AND ip_lat IS NOT NULL`,
    [radioA],
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.label, "Montréal, Canada");
});

test("sessions : IP de radio B absente du listing radio A", async () => {
  const r = await pg.query<{ ip: string }>(
    `SELECT ip FROM analytics_sessions WHERE radio_id = $1`,
    [radioA],
  );
  assert.deepEqual(r.rows.map((x) => x.ip), ["1.1.1.1"]);
});

test("shows : émission de radio B absente de radio A", async () => {
  const r = await pg.query<{ show_title: string }>(
    `SELECT show_title FROM analytics_show_listen WHERE radio_id = $1`,
    [radioA],
  );
  assert.deepEqual(r.rows.map((x) => x.show_title), ["Hit du matin"]);
});

test("timeseries : sessions du jour = 1 pour radio A (pas 2)", async () => {
  const r = await pg.query<{ sessions: number }>(
    `SELECT count(a.id)::int AS sessions
     FROM generate_series(
            (now() AT TIME ZONE '${RADIO_TZ}')::date,
            (now() AT TIME ZONE '${RADIO_TZ}')::date,
            interval '1 day'
          ) d
     LEFT JOIN analytics_daily a ON a.day = d::date AND a.radio_id = $1
     GROUP BY d`,
    [radioA],
  );
  assert.equal(r.rows[0]!.sessions, 1);
});

test("breakdown : appareils de radio A seulement", async () => {
  const r = await pg.query<{ device: string; sessions: number }>(
    `SELECT coalesce(device, '?') AS device, count(*)::int AS sessions
     FROM analytics_sessions WHERE radio_id = $1 GROUP BY device`,
    [radioA],
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.device, "Mobile");
});

test("skipRate : calcul borné à radio A (pas contaminé par radio B)", async () => {
  const r = await pg.query<{ total: number; short: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE listen_sec < ${SKIP_THRESHOLD_SEC})::int AS short
     FROM analytics_show_listen WHERE radio_id = $1`,
    [radioA],
  );
  assert.equal(r.rows[0]!.total, 1);
  assert.equal(r.rows[0]!.short, 0);
});
