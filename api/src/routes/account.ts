/* Routes COMPTE AUDITEUR (grand public, catalogue à la demande du hub En Ondes).
   - Auth : register / login / refresh / logout / me. Refresh via cookie httpOnly
     (eo_listener_refresh) OU body (clients non-navigateur). Access token en JSON.
   - Favoris : liste / ajout / retrait d'une piste du catalogue.
   - Playlists : CRUD + gestion des pistes.
   Séparé du staff : aucun rôle, aucun accès admin. Cross-radio. */

import { Hono } from "hono";
import { z } from "zod";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { eq, and, desc, asc, sql, isNotNull, gte, inArray, notInArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  listeners,
  playlists,
  playlistTracks,
  listenerFavorites,
  trackPlays,
  tracks,
  radios,
} from "../db/schema.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { emailSchema } from "../lib/validation.js";
import { badRequest, unauthorized, notFound, conflict } from "../lib/errors.js";
import { env } from "../env.js";
import { requireListener } from "../middleware/auth.js";
import {
  issueListenerTokens,
  rotateListenerToken,
  revokeListenerToken,
  revokeAllForListener,
  createListenerResetToken,
  consumeListenerResetToken,
  type TokenPair,
} from "../services/listener-auth.js";
import { sendEmail, resetEmailHtml } from "../services/email.js";
import type { AppBindings } from "../types.js";

export const accountRoutes = new Hono<AppBindings>();

const REFRESH_COOKIE = "eo_listener_refresh";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function setRefreshCookie(c: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    // Le hub appelle l'API en same-origin (proxy nginx /api) → Lax suffit et
    // reste first-party. path=/ pour couvrir /api/v1/account/*.
    sameSite: "Lax",
    path: "/",
    maxAge: env.REFRESH_TOKEN_TTL,
  });
}

function tokenResponse(pair: TokenPair) {
  return { accessToken: pair.accessToken, tokenType: "Bearer", expiresIn: pair.expiresIn };
}

function publicListener(l: { id: string; email: string; displayName: string }) {
  return { id: l.id, email: l.email, displayName: l.displayName };
}

// Mot de passe grand public : 8 caractères minimum (moins strict que le staff).
const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, "Mot de passe trop court (≥ 8)").max(200),
  displayName: z.string().trim().min(1).max(80),
});
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

/* ═══════════════════════ AUTH ═══════════════════════ */

/* POST /v1/account/register — crée un compte auditeur et connecte. */
accountRoutes.post("/register", async (c) => {
  const body = registerSchema.parse(await c.req.json());
  const existing = await db.query.listeners.findFirst({ where: eq(listeners.email, body.email) });
  if (existing) throw conflict("Un compte existe déjà pour ce courriel", "email_taken");
  const [row] = await db
    .insert(listeners)
    .values({
      email: body.email,
      passwordHash: await hashPassword(body.password),
      displayName: body.displayName,
    })
    .returning();
  const pair = await issueListenerTokens(row!, c.req.header("User-Agent"));
  setRefreshCookie(c, pair.refreshToken);
  return c.json({ ...tokenResponse(pair), listener: publicListener(row!) }, 201);
});

/* POST /v1/account/login */
accountRoutes.post("/login", async (c) => {
  const body = loginSchema.parse(await c.req.json());
  const row = await db.query.listeners.findFirst({ where: eq(listeners.email, body.email) });
  if (!row || !row.isActive) throw unauthorized("Identifiants invalides", "invalid_credentials");
  const ok = await verifyPassword(body.password, row.passwordHash);
  if (!ok) throw unauthorized("Identifiants invalides", "invalid_credentials");
  await db.update(listeners).set({ lastLoginAt: new Date() }).where(eq(listeners.id, row.id));
  const pair = await issueListenerTokens(row, c.req.header("User-Agent"));
  setRefreshCookie(c, pair.refreshToken);
  return c.json({ ...tokenResponse(pair), listener: publicListener(row) });
});

/* POST /v1/account/refresh — rotation du refresh, nouvel access. */
accountRoutes.post("/refresh", async (c) => {
  let raw = getCookie(c, REFRESH_COOKIE);
  if (!raw) {
    const body = await c.req.json().catch(() => ({}));
    if (body && typeof body.refreshToken === "string") raw = body.refreshToken;
  }
  if (!raw) throw unauthorized("Session absente", "no_refresh");
  const result = await rotateListenerToken(raw, c.req.header("User-Agent"));
  if (!result) {
    deleteCookie(c, REFRESH_COOKIE, { path: "/" });
    throw unauthorized("Session invalide", "invalid_refresh");
  }
  setRefreshCookie(c, result.pair.refreshToken);
  return c.json({ ...tokenResponse(result.pair), listener: publicListener(result.listener) });
});

/* POST /v1/account/logout */
accountRoutes.post("/logout", async (c) => {
  const raw = getCookie(c, REFRESH_COOKIE);
  if (raw) await revokeListenerToken(raw);
  deleteCookie(c, REFRESH_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

/* POST /v1/account/forgot-password — envoie un lien de réinitialisation.
   Réponse toujours { ok:true } (ne révèle pas si l'email existe). Miroir du
   flux staff (auth.ts) sur la table listeners. */
const forgotSchema = z.object({ email: emailSchema });
accountRoutes.post("/forgot-password", async (c) => {
  const { email } = forgotSchema.parse(await c.req.json());
  const row = await db.query.listeners.findFirst({ where: eq(listeners.email, email) });
  if (row && row.isActive) {
    const raw = await createListenerResetToken(row.id, 60 * 60); // 1 h
    const link = `${env.HUB_BASE_URL.replace(/\/$/, "")}/musique.html?reset=${raw}`;
    await sendEmail({
      to: row.email,
      subject: "Réinitialisation de ton mot de passe — En Ondes",
      html: resetEmailHtml(link),
    });
  }
  return c.json({ ok: true });
});

/* POST /v1/account/reset-password — consomme le jeton et fixe le mdp.
   Révoque toutes les sessions existantes. */
const resetSchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(8, "Mot de passe trop court (≥ 8)").max(200),
});
accountRoutes.post("/reset-password", async (c) => {
  const body = resetSchema.parse(await c.req.json());
  const listenerId = await consumeListenerResetToken(body.token);
  if (!listenerId) throw badRequest("Lien invalide ou expiré", "invalid_token");
  await db
    .update(listeners)
    .set({ passwordHash: await hashPassword(body.password), updatedAt: new Date() })
    .where(eq(listeners.id, listenerId));
  await revokeAllForListener(listenerId);
  return c.json({ ok: true });
});

/* GET /v1/account/me */
accountRoutes.get("/me", requireListener, async (c) => {
  const l = c.get("listener");
  return c.json(publicListener(l));
});

/* ═══════════════════════ FAVORIS ═══════════════════════ */

// Colonnes publiques d'une piste (jointes à la radio) — réutilisées ici.
const trackCols = {
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

const playable = and(eq(tracks.status, "published"), isNotNull(tracks.audioUrl));

/* GET /v1/account/favorites — pistes favorites de l'auditeur. */
accountRoutes.get("/favorites", requireListener, async (c) => {
  const l = c.get("listener");
  const rows = await db
    .select(trackCols)
    .from(listenerFavorites)
    .innerJoin(tracks, eq(listenerFavorites.trackId, tracks.id))
    .leftJoin(radios, eq(tracks.radioId, radios.id))
    .where(and(eq(listenerFavorites.listenerId, l.id), playable))
    .orderBy(desc(listenerFavorites.createdAt));
  return c.json(rows);
});

/* PUT /v1/account/favorites/:trackId — ajoute (idempotent). */
accountRoutes.put("/favorites/:trackId", requireListener, async (c) => {
  const l = c.get("listener");
  const trackId = c.req.param("trackId");
  if (!UUID_RE.test(trackId)) throw notFound("Piste introuvable");
  const track = await db.query.tracks.findFirst({ where: eq(tracks.id, trackId) });
  if (!track) throw notFound("Piste introuvable");
  await db
    .insert(listenerFavorites)
    .values({ listenerId: l.id, trackId })
    .onConflictDoNothing();
  return c.json({ ok: true, favorited: true });
});

/* DELETE /v1/account/favorites/:trackId — retire. */
accountRoutes.delete("/favorites/:trackId", requireListener, async (c) => {
  const l = c.get("listener");
  const trackId = c.req.param("trackId");
  await db
    .delete(listenerFavorites)
    .where(and(eq(listenerFavorites.listenerId, l.id), eq(listenerFavorites.trackId, trackId)));
  return c.json({ ok: true, favorited: false });
});

/* ═══════════════════════ HISTORIQUE + RECOMMANDATIONS ═══════════════════════ */

/* GET /v1/account/history — pistes récemment écoutées par l'auditeur (dédupliquées). */
accountRoutes.get("/history", requireListener, async (c) => {
  const l = c.get("listener");
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit")) || 30));
  const rows = await db
    .select({ ...trackCols, lastPlayed: sql<string>`max(${trackPlays.playedAt})` })
    .from(trackPlays)
    .innerJoin(tracks, eq(trackPlays.trackId, tracks.id))
    .leftJoin(radios, eq(tracks.radioId, radios.id))
    .where(and(eq(trackPlays.listenerId, l.id), playable))
    .groupBy(tracks.id, radios.slug, radios.name)
    .orderBy(desc(sql`max(${trackPlays.playedAt})`))
    .limit(limit);
  return c.json(rows);
});

/* GET /v1/account/recommendations — « Pour toi ». Règles simples :
   pistes des genres favoris de l'auditeur, hors favoris déjà posés, triées par
   popularité (écoutes 30 j) puis nouveauté. Repli sur les tendances si l'auditeur
   n'a pas encore de favoris. */
accountRoutes.get("/recommendations", requireListener, async (c) => {
  const l = c.get("listener");
  const limit = Math.min(30, Math.max(1, Number(c.req.query("limit")) || 20));

  // Genres favoris de l'auditeur.
  const favGenres = await db
    .select({ genre: tracks.genre })
    .from(listenerFavorites)
    .innerJoin(tracks, eq(listenerFavorites.trackId, tracks.id))
    .where(and(eq(listenerFavorites.listenerId, l.id), isNotNull(tracks.genre)))
    .groupBy(tracks.genre)
    .orderBy(desc(sql`count(*)`))
    .limit(5);
  const genres = favGenres.map((g) => g.genre).filter((g): g is string => !!g);

  // Ids déjà en favoris (à exclure des recommandations).
  const favIds = (
    await db
      .select({ id: listenerFavorites.trackId })
      .from(listenerFavorites)
      .where(eq(listenerFavorites.listenerId, l.id))
  ).map((r) => r.id);

  const since = sql`now() - interval '30 days'`;
  const where = and(
    playable,
    genres.length ? inArray(tracks.genre, genres) : undefined,
    favIds.length ? notInArray(tracks.id, favIds) : undefined,
  );
  const rows = await db
    .select({ ...trackCols, plays: sql<number>`count(${trackPlays.id})::int` })
    .from(tracks)
    .leftJoin(radios, eq(tracks.radioId, radios.id))
    .leftJoin(trackPlays, and(eq(trackPlays.trackId, tracks.id), gte(trackPlays.playedAt, since)))
    .where(where)
    .groupBy(tracks.id, radios.slug, radios.name)
    .orderBy(desc(sql`count(${trackPlays.id})`), desc(tracks.createdAt))
    .limit(limit);
  return c.json(rows);
});

/* ═══════════════════════ PLAYLISTS ═══════════════════════ */

const playlistInput = z.object({
  name: z.string().trim().min(1).max(120),
  isPublic: z.boolean().optional(),
});

/* GET /v1/account/playlists — playlists de l'auditeur (+ nb de pistes). */
accountRoutes.get("/playlists", requireListener, async (c) => {
  const l = c.get("listener");
  const rows = await db
    .select({
      id: playlists.id,
      name: playlists.name,
      isPublic: playlists.isPublic,
      createdAt: playlists.createdAt,
      updatedAt: playlists.updatedAt,
      trackCount: sql<number>`count(${playlistTracks.id})::int`,
    })
    .from(playlists)
    .leftJoin(playlistTracks, eq(playlistTracks.playlistId, playlists.id))
    .where(eq(playlists.listenerId, l.id))
    .groupBy(playlists.id)
    .orderBy(desc(playlists.updatedAt));
  return c.json(rows);
});

/* POST /v1/account/playlists — crée une playlist. */
accountRoutes.post("/playlists", requireListener, async (c) => {
  const l = c.get("listener");
  const body = playlistInput.parse(await c.req.json());
  const [row] = await db
    .insert(playlists)
    .values({ listenerId: l.id, name: body.name, isPublic: body.isPublic ?? false })
    .returning();
  return c.json({ ...row, trackCount: 0 }, 201);
});

/* Garde-fou : charge une playlist en vérifiant la propriété. */
async function ownedPlaylist(listenerId: string, id: string) {
  if (!UUID_RE.test(id)) throw notFound("Playlist introuvable");
  const pl = await db.query.playlists.findFirst({ where: eq(playlists.id, id) });
  if (!pl || pl.listenerId !== listenerId) throw notFound("Playlist introuvable");
  return pl;
}

/* GET /v1/account/playlists/:id — détail + pistes ordonnées. */
accountRoutes.get("/playlists/:id", requireListener, async (c) => {
  const l = c.get("listener");
  const pl = await ownedPlaylist(l.id, c.req.param("id"));
  const items = await db
    .select({ ...trackCols, position: playlistTracks.position, addedAt: playlistTracks.addedAt })
    .from(playlistTracks)
    .innerJoin(tracks, eq(playlistTracks.trackId, tracks.id))
    .leftJoin(radios, eq(tracks.radioId, radios.id))
    .where(and(eq(playlistTracks.playlistId, pl.id), playable))
    .orderBy(asc(playlistTracks.position), asc(playlistTracks.addedAt));
  return c.json({ ...pl, tracks: items });
});

/* PATCH /v1/account/playlists/:id — renomme / visibilité. */
accountRoutes.patch("/playlists/:id", requireListener, async (c) => {
  const l = c.get("listener");
  const pl = await ownedPlaylist(l.id, c.req.param("id"));
  const body = playlistInput.partial().parse(await c.req.json());
  const [row] = await db
    .update(playlists)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(playlists.id, pl.id))
    .returning();
  return c.json(row);
});

/* DELETE /v1/account/playlists/:id */
accountRoutes.delete("/playlists/:id", requireListener, async (c) => {
  const l = c.get("listener");
  const pl = await ownedPlaylist(l.id, c.req.param("id"));
  await db.delete(playlists).where(eq(playlists.id, pl.id));
  return c.json({ ok: true });
});

/* POST /v1/account/playlists/:id/tracks — ajoute une piste en fin de liste. */
accountRoutes.post("/playlists/:id/tracks", requireListener, async (c) => {
  const l = c.get("listener");
  const pl = await ownedPlaylist(l.id, c.req.param("id"));
  const body = z.object({ trackId: z.string().uuid() }).parse(await c.req.json());
  const track = await db.query.tracks.findFirst({ where: eq(tracks.id, body.trackId) });
  if (!track) throw notFound("Piste introuvable");
  const posRows = await db
    .select({ maxPos: sql<number>`coalesce(max(${playlistTracks.position}), -1)::int` })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, pl.id));
  const nextPos = (posRows[0]?.maxPos ?? -1) + 1;
  await db
    .insert(playlistTracks)
    .values({ playlistId: pl.id, trackId: body.trackId, position: nextPos })
    .onConflictDoNothing();
  await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, pl.id));
  return c.json({ ok: true }, 201);
});

/* DELETE /v1/account/playlists/:id/tracks/:trackId — retire une piste. */
accountRoutes.delete("/playlists/:id/tracks/:trackId", requireListener, async (c) => {
  const l = c.get("listener");
  const pl = await ownedPlaylist(l.id, c.req.param("id"));
  await db
    .delete(playlistTracks)
    .where(and(eq(playlistTracks.playlistId, pl.id), eq(playlistTracks.trackId, c.req.param("trackId"))));
  await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, pl.id));
  return c.json({ ok: true });
});
