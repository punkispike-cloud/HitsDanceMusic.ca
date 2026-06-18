/* Routes publiques (lecture seule, sans token). Elles serviront à terme le
   front sans changer son visuel — d'où le format strict de /schedule. */

import { Hono } from "hono";
import { eq, asc, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { artists, shows, episodes, mixes } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import { getScheduleShape, getCurrentSlot } from "../services/schedule.js";
import { fromMinutes } from "../lib/validation.js";

export const publicRoutes = new Hono();

/* GET /v1/schedule — format SCHEDULE exact. */
publicRoutes.get("/schedule", async (c) => {
  const shape = await getScheduleShape();
  c.header("Cache-Control", "public, max-age=60");
  return c.json(shape);
});

/* GET /v1/schedule/now — créneau courant (heure Montréal). */
publicRoutes.get("/schedule/now", async (c) => {
  const slot = await getCurrentSlot();
  if (!slot) return c.json(null);
  return c.json({
    from: fromMinutes(slot.startMin),
    to: slot.endMin === 1440 ? "00:00" : fromMinutes(slot.endMin),
    title: slot.title,
    host: slot.hostLabel,
    tag: slot.tag,
    isLive: slot.isLive,
  });
});

/* GET /v1/artists — animateurs publiés, triés. */
publicRoutes.get("/artists", async (c) => {
  const rows = await db
    .select()
    .from(artists)
    .where(eq(artists.isPublished, true))
    .orderBy(asc(artists.sortOrder), asc(artists.name));
  c.header("Cache-Control", "public, max-age=60");
  return c.json(rows);
});

publicRoutes.get("/artists/:slug", async (c) => {
  const row = await db.query.artists.findFirst({
    where: and(eq(artists.slug, c.req.param("slug")), eq(artists.isPublished, true)),
  });
  if (!row) throw notFound("Animateur introuvable");
  return c.json(row);
});

/* GET /v1/shows — émissions publiées. */
publicRoutes.get("/shows", async (c) => {
  const rows = await db
    .select()
    .from(shows)
    .where(eq(shows.isPublished, true))
    .orderBy(asc(shows.sortOrder), asc(shows.title));
  c.header("Cache-Control", "public, max-age=60");
  return c.json(rows);
});

publicRoutes.get("/shows/:slug", async (c) => {
  const row = await db.query.shows.findFirst({
    where: and(eq(shows.slug, c.req.param("slug")), eq(shows.isPublished, true)),
  });
  if (!row) throw notFound("Émission introuvable");
  return c.json(row);
});

/* GET /v1/episodes — podcasts publiés. */
publicRoutes.get("/episodes", async (c) => {
  const rows = await db
    .select()
    .from(episodes)
    .where(eq(episodes.status, "published"))
    .orderBy(asc(episodes.publishedAt));
  return c.json(rows);
});

publicRoutes.get("/episodes/:slug", async (c) => {
  const row = await db.query.episodes.findFirst({
    where: and(eq(episodes.slug, c.req.param("slug")), eq(episodes.status, "published")),
  });
  if (!row) throw notFound("Épisode introuvable");
  return c.json(row);
});

/* GET /v1/mixes — mixes publiés. */
publicRoutes.get("/mixes", async (c) => {
  const rows = await db
    .select()
    .from(mixes)
    .where(eq(mixes.status, "published"))
    .orderBy(asc(mixes.publishedAt));
  return c.json(rows);
});

publicRoutes.get("/mixes/:slug", async (c) => {
  const row = await db.query.mixes.findFirst({
    where: and(eq(mixes.slug, c.req.param("slug")), eq(mixes.status, "published")),
  });
  if (!row) throw notFound("Mix introuvable");
  return c.json(row);
});
