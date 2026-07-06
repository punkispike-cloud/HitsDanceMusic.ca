/* Catalogue musical PUBLIC à la demande (hub En Ondes).
   Contrairement aux autres routes /v1 (cloisonnées par radio via publicTenant),
   le catalogue est CROSS-RADIO : il agrège les pistes `published` ET jouables
   (audioUrl présent) de TOUTES les radios du parc, avec attribution de la station.
   Lecture seule, sans token. Base = table `tracks` (bibliothèque libre de droits). */

import { Hono } from "hono";
import { eq, and, or, ilike, asc, desc, isNotNull, sql, gte } from "drizzle-orm";
import { db } from "../db/client.js";
import { tracks, radios, trackPlays } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import { verifyListenerToken } from "../lib/jwt.js";
import type { AppBindings } from "../types.js";

export const catalogRoutes = new Hono<AppBindings>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Borne de pagination (publique → plafond bas pour limiter la charge). */
function pageLimit(c: { req: { query: (k: string) => string | undefined } }): number {
  return Math.min(100, Math.max(1, Number(c.req.query("limit")) || 40));
}
function pageOffset(c: { req: { query: (k: string) => string | undefined } }): number {
  return Math.max(0, Number(c.req.query("offset")) || 0);
}

/* Forme publique d'une piste (on n'expose ni audioKey ni sizeBytes). */
const publicTrackColumns = {
  id: tracks.id,
  artist: tracks.artist,
  title: tracks.title,
  genre: tracks.genre,
  bpm: tracks.bpm,
  durationSec: tracks.durationSec,
  audioUrl: tracks.audioUrl,
  source: tracks.source,
  license: tracks.license,
  createdAt: tracks.createdAt,
  radioSlug: radios.slug,
  radioName: radios.name,
} as const;

/* Seules les pistes publiées ET dotées d'un fichier audio sont écoutables. */
const playable = and(eq(tracks.status, "published"), isNotNull(tracks.audioUrl));

/* GET /v1/catalog/tracks?q=&genre=&sort=&limit=&offset=
   Parcours + recherche du catalogue (toutes radios confondues). */
catalogRoutes.get("/catalog/tracks", async (c) => {
  const q = c.req.query("q")?.trim();
  const genre = c.req.query("genre")?.trim();
  const sort = c.req.query("sort")?.trim() ?? "recent";

  const where = and(
    playable,
    q ? or(ilike(tracks.artist, `%${q}%`), ilike(tracks.title, `%${q}%`), ilike(tracks.genre, `%${q}%`)) : undefined,
    genre ? eq(tracks.genre, genre) : undefined,
  );

  const orderBy =
    sort === "title"
      ? [asc(tracks.title), asc(tracks.artist)]
      : sort === "artist"
        ? [asc(tracks.artist), asc(tracks.title)]
        : [desc(tracks.createdAt)];

  const rows = await db
    .select(publicTrackColumns)
    .from(tracks)
    .leftJoin(radios, eq(tracks.radioId, radios.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(pageLimit(c))
    .offset(pageOffset(c));

  c.header("Cache-Control", "public, max-age=30");
  return c.json(rows);
});

/* GET /v1/catalog/genres — genres distincts (avec compte) parmi les pistes jouables. */
catalogRoutes.get("/catalog/genres", async (c) => {
  const rows = await db
    .select({ genre: tracks.genre, count: sql<number>`count(*)::int` })
    .from(tracks)
    .where(and(playable, isNotNull(tracks.genre)))
    .groupBy(tracks.genre)
    .orderBy(desc(sql`count(*)`), asc(tracks.genre));

  c.header("Cache-Control", "public, max-age=60");
  return c.json(rows);
});

/* GET /v1/catalog/trending — pistes les plus écoutées (30 derniers jours).
   Repli sur les plus récentes si aucune écoute enregistrée. */
catalogRoutes.get("/catalog/trending", async (c) => {
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit")) || 20));
  const since = sql`now() - interval '30 days'`;
  const rows = await db
    .select({ ...publicTrackColumns, plays: sql<number>`count(${trackPlays.id})::int` })
    .from(tracks)
    .leftJoin(radios, eq(tracks.radioId, radios.id))
    .leftJoin(trackPlays, and(eq(trackPlays.trackId, tracks.id), gte(trackPlays.playedAt, since)))
    .where(playable)
    .groupBy(tracks.id, radios.slug, radios.name)
    .orderBy(desc(sql`count(${trackPlays.id})`), desc(tracks.createdAt))
    .limit(limit);

  c.header("Cache-Control", "public, max-age=60");
  return c.json(rows);
});

/* POST /v1/catalog/tracks/:id/play — beacon de lecture (compteur + historique).
   Attribution à l'auditeur si un token « listener » valide est présent, sinon
   écoute anonyme. Tolérant : n'échoue jamais côté client (best-effort). */
catalogRoutes.post("/catalog/tracks/:id/play", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ ok: false });
  const track = await db.query.tracks.findFirst({ where: and(eq(tracks.id, id), playable), columns: { id: true } });
  if (!track) return c.json({ ok: false });

  let listenerId: string | null = null;
  const auth = c.req.header("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) {
    const claims = await verifyListenerToken(m[1]!);
    if (claims) listenerId = claims.sub;
  }
  await db.insert(trackPlays).values({ trackId: id, listenerId });
  return c.json({ ok: true });
});

/* GET /v1/catalog/tracks/:id — fiche d'une piste jouable. */
catalogRoutes.get("/catalog/tracks/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) throw notFound("Piste introuvable");
  const [row] = await db
    .select(publicTrackColumns)
    .from(tracks)
    .leftJoin(radios, eq(tracks.radioId, radios.id))
    .where(and(eq(tracks.id, id), playable))
    .limit(1);
  if (!row) throw notFound("Piste introuvable");
  return c.json(row);
});
