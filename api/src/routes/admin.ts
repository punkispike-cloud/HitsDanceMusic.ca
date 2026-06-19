/* CRUD d'administration, monté sous /v1/admin (requireAuth global appliqué
   à l'app au montage). Lecture : lecteur+. Écriture : superadmin, ou
   animateur propriétaire de la ressource (ownership via artist_id). */

import { Hono } from "hono";
import { z } from "zod";
import { eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  artists,
  shows,
  scheduleSlots,
  users,
  episodes,
  mixes,
} from "../db/schema.js";
import { slugify, slotTagSchema, registerSchema } from "../lib/validation.js";
import { hashPassword } from "../lib/password.js";
import { badRequest, notFound, conflict, forbidden } from "../lib/errors.js";
import { requireRole, requireOwnershipOrAdmin, assertCanActAs } from "../middleware/rbac.js";
import { createAuthToken } from "../services/auth-tokens.js";
import { sendEmail, inviteEmailHtml } from "../services/email.js";
import { env, isResendConfigured } from "../env.js";
import { randomBytes } from "node:crypto";
import type { AppBindings } from "../types.js";

export const adminRoutes = new Hono<AppBindings>();

/* Borne de pagination commune aux listes (défaut large : le CRUD admin
   attend un tableau ; la recherche `q` réduit le volume côté serveur). */
function listLimit(c: { req: { query: (k: string) => string | undefined } }): number {
  return Math.min(1000, Math.max(1, Number(c.req.query("limit")) || 1000));
}
function listOffset(c: { req: { query: (k: string) => string | undefined } }): number {
  return Math.max(0, Number(c.req.query("offset")) || 0);
}

/* ───────── Owner loaders (pour requireOwnershipOrAdmin) ───────── */
const loadShowOwner = async (id: string) =>
  db.query.shows.findFirst({ where: eq(shows.id, id), columns: { artistId: true } });
const loadSlotOwner = async (id: string) =>
  db.query.scheduleSlots.findFirst({ where: eq(scheduleSlots.id, id), columns: { artistId: true } });
const loadEpisodeOwner = async (id: string) =>
  db.query.episodes.findFirst({ where: eq(episodes.id, id), columns: { artistId: true } });
const loadMixOwner = async (id: string) =>
  db.query.mixes.findFirst({ where: eq(mixes.id, id), columns: { artistId: true } });

/* ═══════════════════════ ARTISTS ═══════════════════════ */

const artistInput = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().optional(),
  photoUrl: z.string().trim().max(500).nullish(),
  initials: z.string().trim().max(4).nullish(),
  showTitle: z.string().trim().max(200).nullish(),
  scheduleText: z.string().trim().max(200).nullish(),
  bio: z.string().trim().max(2000).nullish(),
  socials: z.record(z.string()).optional(),
  sortOrder: z.number().int().optional(),
  isPublished: z.boolean().optional(),
});

adminRoutes.get("/artists", async (c) => {
  const q = c.req.query("q")?.trim();
  const where: SQL | undefined = q
    ? or(ilike(artists.name, `%${q}%`), ilike(artists.slug, `%${q}%`))
    : undefined;
  return c.json(
    await db
      .select()
      .from(artists)
      .where(where)
      .orderBy(artists.sortOrder)
      .limit(listLimit(c))
      .offset(listOffset(c)),
  );
});

adminRoutes.post("/artists", requireRole("superadmin"), async (c) => {
  const body = artistInput.parse(await c.req.json());
  const slug = slugify(body.slug || body.name);
  if (await db.query.artists.findFirst({ where: eq(artists.slug, slug) }))
    throw conflict("Slug déjà utilisé");
  const [row] = await db
    .insert(artists)
    .values({ ...body, slug, socials: body.socials ?? {} })
    .returning();
  return c.json(row, 201);
});

adminRoutes.patch(
  "/artists/:id",
  // Un animateur peut éditer SA fiche (celle liée à son compte).
  async (c, next) => {
    const user = c.get("user");
    if (user.role === "superadmin") return next();
    if (user.artistId && user.artistId === c.req.param("id")) return next();
    throw forbidden("Tu ne peux modifier que ta propre fiche");
  },
  async (c) => {
    const id = c.req.param("id");
    const body = artistInput.partial().parse(await c.req.json());
    const patch: Record<string, unknown> = { ...body, updatedAt: new Date() };
    if (body.slug || body.name) patch.slug = slugify(body.slug || body.name!);
    const [row] = await db.update(artists).set(patch).where(eq(artists.id, id)).returning();
    if (!row) throw notFound("Animateur introuvable");
    return c.json(row);
  },
);

adminRoutes.delete("/artists/:id", requireRole("superadmin"), async (c) => {
  const [row] = await db.delete(artists).where(eq(artists.id, c.req.param("id"))).returning();
  if (!row) throw notFound("Animateur introuvable");
  return c.json({ ok: true });
});

/* ═══════════════════════ SHOWS ═══════════════════════ */

const showInput = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().optional(),
  description: z.string().trim().max(4000).nullish(),
  tag: slotTagSchema.nullish(),
  badge: z.string().trim().max(60).nullish(),
  artistId: z.string().uuid().nullish(),
  scheduleText: z.string().trim().max(200).nullish(),
  sortOrder: z.number().int().optional(),
  isPublished: z.boolean().optional(),
});

adminRoutes.get("/shows", async (c) => {
  const q = c.req.query("q")?.trim();
  const where: SQL | undefined = q
    ? or(ilike(shows.title, `%${q}%`), ilike(shows.slug, `%${q}%`))
    : undefined;
  return c.json(
    await db.select().from(shows).where(where).orderBy(shows.sortOrder).limit(listLimit(c)).offset(listOffset(c)),
  );
});

adminRoutes.post("/shows", requireRole("superadmin", "animateur"), async (c) => {
  const user = c.get("user");
  const body = showInput.parse(await c.req.json());
  // Un animateur ne peut créer une émission que rattachée à lui-même.
  const artistId = user.role === "superadmin" ? body.artistId ?? null : user.artistId;
  assertCanActAs(user, artistId);
  const slug = slugify(body.slug || body.title);
  if (await db.query.shows.findFirst({ where: eq(shows.slug, slug) }))
    throw conflict("Slug déjà utilisé");
  const [row] = await db.insert(shows).values({ ...body, slug, artistId }).returning();
  return c.json(row, 201);
});

adminRoutes.patch("/shows/:id", requireOwnershipOrAdmin(loadShowOwner), async (c) => {
  const id = c.req.param("id");
  const body = showInput.partial().parse(await c.req.json());
  const patch: Record<string, unknown> = { ...body, updatedAt: new Date() };
  if (body.slug || body.title) patch.slug = slugify(body.slug || body.title!);
  const [row] = await db.update(shows).set(patch).where(eq(shows.id, id)).returning();
  if (!row) throw notFound("Émission introuvable");
  return c.json(row);
});

adminRoutes.delete("/shows/:id", requireOwnershipOrAdmin(loadShowOwner), async (c) => {
  const [row] = await db.delete(shows).where(eq(shows.id, c.req.param("id"))).returning();
  if (!row) throw notFound("Émission introuvable");
  return c.json({ ok: true });
});

/* ═══════════════════════ SCHEDULE SLOTS ═══════════════════════ */

const slotInput = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startMin: z.number().int().min(0).max(1440),
  endMin: z.number().int().min(1).max(1440),
  title: z.string().trim().min(1).max(200),
  hostLabel: z.string().trim().min(1).max(120),
  tag: slotTagSchema,
  showId: z.string().uuid().nullish(),
  artistId: z.string().uuid().nullish(),
  isLive: z.boolean().optional(),
});

adminRoutes.get("/schedule-slots", async (c) => {
  return c.json(
    await db.select().from(scheduleSlots).orderBy(scheduleSlots.dayOfWeek, scheduleSlots.startMin),
  );
});

adminRoutes.post("/schedule-slots", requireRole("superadmin", "animateur"), async (c) => {
  const user = c.get("user");
  const body = slotInput.parse(await c.req.json());
  if (body.startMin >= body.endMin) throw badRequest("startMin doit être < endMin");
  const artistId = user.role === "superadmin" ? body.artistId ?? null : user.artistId;
  assertCanActAs(user, artistId);
  const [row] = await db.insert(scheduleSlots).values({ ...body, artistId }).returning();
  return c.json(row, 201);
});

adminRoutes.patch(
  "/schedule-slots/:id",
  requireOwnershipOrAdmin(loadSlotOwner),
  async (c) => {
    const id = c.req.param("id");
    const body = slotInput.partial().parse(await c.req.json());
    if (body.startMin != null && body.endMin != null && body.startMin >= body.endMin)
      throw badRequest("startMin doit être < endMin");
    const [row] = await db
      .update(scheduleSlots)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(scheduleSlots.id, id))
      .returning();
    if (!row) throw notFound("Créneau introuvable");
    return c.json(row);
  },
);

adminRoutes.delete(
  "/schedule-slots/:id",
  requireOwnershipOrAdmin(loadSlotOwner),
  async (c) => {
    const [row] = await db
      .delete(scheduleSlots)
      .where(eq(scheduleSlots.id, c.req.param("id")))
      .returning();
    if (!row) throw notFound("Créneau introuvable");
    return c.json({ ok: true });
  },
);

/* ═══════════════════════ EPISODES (métadonnées ; audio en Phase 4) ═══════════════════════ */

const episodeInput = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().optional(),
  showId: z.string().uuid().nullish(),
  artistId: z.string().uuid().nullish(),
  description: z.string().trim().max(8000).nullish(),
  season: z.number().int().nullish(),
  episodeNumber: z.number().int().nullish(),
  coverUrl: z.string().trim().max(500).nullish(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  publishedAt: z.string().datetime().nullish(),
  tags: z.array(z.string()).optional(),
});

adminRoutes.get("/episodes", async (c) => {
  const q = c.req.query("q")?.trim();
  const where: SQL | undefined = q ? ilike(episodes.title, `%${q}%`) : undefined;
  return c.json(
    await db.select().from(episodes).where(where).orderBy(episodes.createdAt).limit(listLimit(c)).offset(listOffset(c)),
  );
});

adminRoutes.post("/episodes", requireRole("superadmin", "animateur"), async (c) => {
  const user = c.get("user");
  const body = episodeInput.parse(await c.req.json());
  const artistId = user.role === "superadmin" ? body.artistId ?? null : user.artistId;
  if (!artistId) throw badRequest("artistId requis");
  assertCanActAs(user, artistId);
  const slug = slugify(body.slug || body.title);
  if (await db.query.episodes.findFirst({ where: eq(episodes.slug, slug) }))
    throw conflict("Slug déjà utilisé");
  const [row] = await db
    .insert(episodes)
    .values({
      ...body,
      slug,
      artistId,
      publishedAt: body.publishedAt ? new Date(body.publishedAt) : null,
    })
    .returning();
  return c.json(row, 201);
});

adminRoutes.patch("/episodes/:id", requireOwnershipOrAdmin(loadEpisodeOwner), async (c) => {
  const id = c.req.param("id");
  const body = episodeInput.partial().parse(await c.req.json());
  const patch: Record<string, unknown> = { ...body, updatedAt: new Date() };
  if (body.slug || body.title) patch.slug = slugify(body.slug || body.title!);
  if (body.publishedAt !== undefined)
    patch.publishedAt = body.publishedAt ? new Date(body.publishedAt) : null;
  const [row] = await db.update(episodes).set(patch).where(eq(episodes.id, id)).returning();
  if (!row) throw notFound("Épisode introuvable");
  return c.json(row);
});

adminRoutes.delete("/episodes/:id", requireOwnershipOrAdmin(loadEpisodeOwner), async (c) => {
  const [row] = await db.delete(episodes).where(eq(episodes.id, c.req.param("id"))).returning();
  if (!row) throw notFound("Épisode introuvable");
  return c.json({ ok: true });
});

/* ═══════════════════════ MIXES ═══════════════════════ */

const mixInput = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().optional(),
  artistId: z.string().uuid().nullish(),
  description: z.string().trim().max(8000).nullish(),
  genre: z.string().trim().max(60).nullish(),
  coverUrl: z.string().trim().max(500).nullish(),
  tracklist: z.array(z.record(z.unknown())).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  publishedAt: z.string().datetime().nullish(),
  tags: z.array(z.string()).optional(),
});

adminRoutes.get("/mixes", async (c) => {
  const q = c.req.query("q")?.trim();
  const where: SQL | undefined = q
    ? or(ilike(mixes.title, `%${q}%`), ilike(mixes.genre, `%${q}%`))
    : undefined;
  return c.json(
    await db.select().from(mixes).where(where).orderBy(mixes.createdAt).limit(listLimit(c)).offset(listOffset(c)),
  );
});

adminRoutes.post("/mixes", requireRole("superadmin", "animateur"), async (c) => {
  const user = c.get("user");
  const body = mixInput.parse(await c.req.json());
  const artistId = user.role === "superadmin" ? body.artistId ?? null : user.artistId;
  if (!artistId) throw badRequest("artistId requis");
  assertCanActAs(user, artistId);
  const slug = slugify(body.slug || body.title);
  if (await db.query.mixes.findFirst({ where: eq(mixes.slug, slug) }))
    throw conflict("Slug déjà utilisé");
  const [row] = await db
    .insert(mixes)
    .values({
      ...body,
      slug,
      artistId,
      tracklist: body.tracklist ?? [],
      publishedAt: body.publishedAt ? new Date(body.publishedAt) : null,
    })
    .returning();
  return c.json(row, 201);
});

adminRoutes.patch("/mixes/:id", requireOwnershipOrAdmin(loadMixOwner), async (c) => {
  const id = c.req.param("id");
  const body = mixInput.partial().parse(await c.req.json());
  const patch: Record<string, unknown> = { ...body, updatedAt: new Date() };
  if (body.slug || body.title) patch.slug = slugify(body.slug || body.title!);
  if (body.publishedAt !== undefined)
    patch.publishedAt = body.publishedAt ? new Date(body.publishedAt) : null;
  const [row] = await db.update(mixes).set(patch).where(eq(mixes.id, id)).returning();
  if (!row) throw notFound("Mix introuvable");
  return c.json(row);
});

adminRoutes.delete("/mixes/:id", requireOwnershipOrAdmin(loadMixOwner), async (c) => {
  const [row] = await db.delete(mixes).where(eq(mixes.id, c.req.param("id"))).returning();
  if (!row) throw notFound("Mix introuvable");
  return c.json({ ok: true });
});

/* ═══════════════════════ USERS (superadmin uniquement) ═══════════════════════ */

const userPatch = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["superadmin", "animateur", "lecteur"]).optional(),
  artistId: z.string().uuid().nullish(),
  isActive: z.boolean().optional(),
});

function publicUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    artistId: u.artistId,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt,
  };
}

adminRoutes.get("/users", requireRole("superadmin"), async (c) => {
  const q = c.req.query("q")?.trim();
  const where: SQL | undefined = q
    ? or(ilike(users.email, `%${q}%`), ilike(users.displayName, `%${q}%`))
    : undefined;
  const rows = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(users.createdAt)
    .limit(listLimit(c))
    .offset(listOffset(c));
  return c.json(rows.map(publicUser));
});

// Création de compte : mot de passe explicite OU invitation par email
// (password omis → compte inactif + lien « définir le mot de passe »).
const userCreateSchema = registerSchema
  .extend({
    password: registerSchema.shape.password.optional(),
    invite: z.boolean().optional(),
  });

adminRoutes.post("/users", requireRole("superadmin"), async (c) => {
  const body = userCreateSchema.parse(await c.req.json());
  if (await db.query.users.findFirst({ where: eq(users.email, body.email) }))
    throw conflict("Email déjà utilisé");

  const byInvite = body.invite === true || !body.password;
  // Sans mot de passe : on en pose un aléatoire (impossible à deviner) et le
  // compte reste inactif tant que l'invitation n'est pas acceptée.
  const rawPassword = body.password ?? randomBytes(24).toString("base64url");

  const [row] = await db
    .insert(users)
    .values({
      email: body.email,
      passwordHash: await hashPassword(rawPassword),
      displayName: body.displayName,
      role: body.role,
      artistId: body.artistId ?? null,
      isActive: !byInvite,
    })
    .returning();

  let invited = false;
  if (byInvite) {
    const token = await createAuthToken(row!.id, "invite", 48 * 60 * 60); // 48 h
    const link = `${env.ADMIN_BASE_URL.replace(/\/$/, "")}/set-password?token=${token}`;
    invited = await sendEmail({
      to: row!.email,
      subject: "Ton accès à la console Hits Dance Music",
      html: inviteEmailHtml(row!.displayName, link),
    });
  }

  return c.json({ ...publicUser(row!), invited, emailConfigured: isResendConfigured() }, 201);
});

/* POST /users/:id/invite — (re)génère et envoie un lien d'invitation. */
adminRoutes.post("/users/:id/invite", requireRole("superadmin"), async (c) => {
  const user = await db.query.users.findFirst({ where: eq(users.id, c.req.param("id")) });
  if (!user) throw notFound("Utilisateur introuvable");
  const token = await createAuthToken(user.id, "invite", 48 * 60 * 60);
  const link = `${env.ADMIN_BASE_URL.replace(/\/$/, "")}/set-password?token=${token}`;
  const invited = await sendEmail({
    to: user.email,
    subject: "Ton accès à la console Hits Dance Music",
    html: inviteEmailHtml(user.displayName, link),
  });
  return c.json({ ok: true, invited, emailConfigured: isResendConfigured() });
});

adminRoutes.patch("/users/:id", requireRole("superadmin"), async (c) => {
  const body = userPatch.parse(await c.req.json());
  const [row] = await db
    .update(users)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(users.id, c.req.param("id")))
    .returning();
  if (!row) throw notFound("Utilisateur introuvable");
  return c.json(publicUser(row));
});

adminRoutes.delete("/users/:id", requireRole("superadmin"), async (c) => {
  const id = c.req.param("id");
  if (id === c.get("user").userId) throw badRequest("Tu ne peux pas supprimer ton propre compte");
  const [row] = await db.delete(users).where(eq(users.id, id)).returning();
  if (!row) throw notFound("Utilisateur introuvable");
  return c.json({ ok: true });
});
