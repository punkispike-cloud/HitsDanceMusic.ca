/* CRUD d'administration, monté sous /v1/admin (requireAuth + adminTenant
   appliqués au montage → `radioId` résolu sur le contexte). Tout est filtré
   par radio (mur multi-tenant) : un admin ne voit/touche QUE sa radio.
   Lecture : lecteur+. Écriture éditoriale : superadmin + owner
   (requireEditorialAdmin) — `it` est EXCLU (technique, pas éditorial) ; ou
   animateur propriétaire (requireOwnershipOrAdmin). */

import { Hono } from "hono";
import { z } from "zod";
import { eq, and, ilike, or, desc, sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  artists,
  shows,
  scheduleSlots,
  users,
  episodes,
  mixes,
  tracks,
  songRequests,
  polls,
  pollVotes,
} from "../db/schema.js";
import { slugify, slotTagSchema, registerSchema, roleSchema } from "../lib/validation.js";
import { hashPassword } from "../lib/password.js";
import { badRequest, notFound, conflict, forbidden } from "../lib/errors.js";
import {
  requireRole,
  requireEditorialAdmin,
  requireOwnershipOrAdmin,
  assertCanActAs,
  assertCanAssignRole,
  assertCanManageUser,
  isEditorialAdmin,
  isCrossRadio,
  RANK,
} from "../middleware/rbac.js";
import { requireRadioId } from "../services/tenant.js";
import { createAuthToken } from "../services/auth-tokens.js";
import { sendEmail, inviteEmailHtml } from "../services/email.js";
import { env, isResendConfigured } from "../env.js";
import { randomBytes } from "node:crypto";
import type { AppBindings } from "../types.js";
import type { RequestStatus } from "../db/schema.js";

export const adminRoutes = new Hono<AppBindings>();

/* Borne de pagination commune aux listes. */
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
  const radioId = requireRadioId(c.get("radioId"));
  const q = c.req.query("q")?.trim();
  const where = and(
    eq(artists.radioId, radioId),
    q ? or(ilike(artists.name, `%${q}%`), ilike(artists.slug, `%${q}%`)) : undefined,
  );
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

adminRoutes.post("/artists", requireEditorialAdmin, async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const body = artistInput.parse(await c.req.json());
  const slug = slugify(body.slug || body.name);
  if (await db.query.artists.findFirst({ where: and(eq(artists.radioId, radioId), eq(artists.slug, slug)) }))
    throw conflict("Slug déjà utilisé");
  const [row] = await db
    .insert(artists)
    .values({ ...body, radioId, slug, socials: body.socials ?? {} })
    .returning();
  return c.json(row, 201);
});

adminRoutes.patch(
  "/artists/:id",
  // Un animateur peut éditer SA fiche (celle liée à son compte). `it` est bloqué
  // (pas éditorial, pas d'artiste).
  async (c, next) => {
    const user = c.get("user");
    if (isEditorialAdmin(user.role)) return next();
    if (user.artistId && user.artistId === c.req.param("id")) return next();
    throw forbidden("Tu ne peux modifier que ta propre fiche");
  },
  async (c) => {
    const radioId = requireRadioId(c.get("radioId"));
    const id = c.req.param("id");
    const body = artistInput.partial().parse(await c.req.json());
    const patch: Record<string, unknown> = { ...body, updatedAt: new Date() };
    if (body.slug || body.name) patch.slug = slugify(body.slug || body.name!);
    const [row] = await db
      .update(artists)
      .set(patch)
      .where(and(eq(artists.id, id), eq(artists.radioId, radioId)))
      .returning();
    if (!row) throw notFound("Animateur introuvable");
    return c.json(row);
  },
);

adminRoutes.delete("/artists/:id", requireEditorialAdmin, async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const [row] = await db
    .delete(artists)
    .where(and(eq(artists.id, c.req.param("id")), eq(artists.radioId, radioId)))
    .returning();
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
  const radioId = requireRadioId(c.get("radioId"));
  const q = c.req.query("q")?.trim();
  const where = and(
    eq(shows.radioId, radioId),
    q ? or(ilike(shows.title, `%${q}%`), ilike(shows.slug, `%${q}%`)) : undefined,
  );
  return c.json(
    await db.select().from(shows).where(where).orderBy(shows.sortOrder).limit(listLimit(c)).offset(listOffset(c)),
  );
});

adminRoutes.post("/shows", requireRole("animateur", "superadmin", "owner"), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const user = c.get("user");
  const body = showInput.parse(await c.req.json());
  // Un animateur ne peut créer une émission que rattachée à lui-même. `it` est
  // bloqué au middleware (pas dans la liste) — pas éditorial.
  const artistId = isEditorialAdmin(user.role) ? body.artistId ?? null : user.artistId;
  assertCanActAs(user, artistId);
  const slug = slugify(body.slug || body.title);
  if (await db.query.shows.findFirst({ where: and(eq(shows.radioId, radioId), eq(shows.slug, slug)) }))
    throw conflict("Slug déjà utilisé");
  const [row] = await db.insert(shows).values({ ...body, radioId, slug, artistId }).returning();
  return c.json(row, 201);
});

adminRoutes.patch("/shows/:id", requireOwnershipOrAdmin(loadShowOwner), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const id = c.req.param("id");
  const body = showInput.partial().parse(await c.req.json());
  const patch: Record<string, unknown> = { ...body, updatedAt: new Date() };
  if (body.slug || body.title) patch.slug = slugify(body.slug || body.title!);
  const [row] = await db
    .update(shows)
    .set(patch)
    .where(and(eq(shows.id, id), eq(shows.radioId, radioId)))
    .returning();
  if (!row) throw notFound("Émission introuvable");
  return c.json(row);
});

adminRoutes.delete("/shows/:id", requireOwnershipOrAdmin(loadShowOwner), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const [row] = await db
    .delete(shows)
    .where(and(eq(shows.id, c.req.param("id")), eq(shows.radioId, radioId)))
    .returning();
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
  const radioId = requireRadioId(c.get("radioId"));
  return c.json(
    await db
      .select()
      .from(scheduleSlots)
      .where(eq(scheduleSlots.radioId, radioId))
      .orderBy(scheduleSlots.dayOfWeek, scheduleSlots.startMin),
  );
});

adminRoutes.post("/schedule-slots", requireRole("animateur", "superadmin", "owner"), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const user = c.get("user");
  const body = slotInput.parse(await c.req.json());
  if (body.startMin >= body.endMin) throw badRequest("startMin doit être < endMin");
  const artistId = isEditorialAdmin(user.role) ? body.artistId ?? null : user.artistId;
  assertCanActAs(user, artistId);
  const [row] = await db.insert(scheduleSlots).values({ ...body, radioId, artistId }).returning();
  return c.json(row, 201);
});

adminRoutes.patch(
  "/schedule-slots/:id",
  requireOwnershipOrAdmin(loadSlotOwner),
  async (c) => {
    const radioId = requireRadioId(c.get("radioId"));
    const id = c.req.param("id");
    const body = slotInput.partial().parse(await c.req.json());
    if (body.startMin != null && body.endMin != null && body.startMin >= body.endMin)
      throw badRequest("startMin doit être < endMin");
    const [row] = await db
      .update(scheduleSlots)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(scheduleSlots.id, id), eq(scheduleSlots.radioId, radioId)))
      .returning();
    if (!row) throw notFound("Créneau introuvable");
    return c.json(row);
  },
);

adminRoutes.delete(
  "/schedule-slots/:id",
  requireOwnershipOrAdmin(loadSlotOwner),
  async (c) => {
    const radioId = requireRadioId(c.get("radioId"));
    const [row] = await db
      .delete(scheduleSlots)
      .where(and(eq(scheduleSlots.id, c.req.param("id")), eq(scheduleSlots.radioId, radioId)))
      .returning();
    if (!row) throw notFound("Créneau introuvable");
    return c.json({ ok: true });
  },
);

/* ═══════════════════════ EPISODES (podcasts) ═══════════════════════ */

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
  const radioId = requireRadioId(c.get("radioId"));
  const q = c.req.query("q")?.trim();
  const where = and(eq(episodes.radioId, radioId), q ? ilike(episodes.title, `%${q}%`) : undefined);
  return c.json(
    await db.select().from(episodes).where(where).orderBy(episodes.createdAt).limit(listLimit(c)).offset(listOffset(c)),
  );
});

adminRoutes.post("/episodes", requireRole("animateur", "superadmin", "owner"), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const user = c.get("user");
  const body = episodeInput.parse(await c.req.json());
  const artistId = isEditorialAdmin(user.role) ? body.artistId ?? null : user.artistId;
  if (!artistId) throw badRequest("artistId requis");
  assertCanActAs(user, artistId);
  const slug = slugify(body.slug || body.title);
  if (await db.query.episodes.findFirst({ where: and(eq(episodes.radioId, radioId), eq(episodes.slug, slug)) }))
    throw conflict("Slug déjà utilisé");
  const [row] = await db
    .insert(episodes)
    .values({
      ...body,
      radioId,
      slug,
      artistId,
      publishedAt: body.publishedAt ? new Date(body.publishedAt) : null,
    })
    .returning();
  return c.json(row, 201);
});

adminRoutes.patch("/episodes/:id", requireOwnershipOrAdmin(loadEpisodeOwner), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const id = c.req.param("id");
  const body = episodeInput.partial().parse(await c.req.json());
  const patch: Record<string, unknown> = { ...body, updatedAt: new Date() };
  if (body.slug || body.title) patch.slug = slugify(body.slug || body.title!);
  if (body.publishedAt !== undefined)
    patch.publishedAt = body.publishedAt ? new Date(body.publishedAt) : null;
  const [row] = await db
    .update(episodes)
    .set(patch)
    .where(and(eq(episodes.id, id), eq(episodes.radioId, radioId)))
    .returning();
  if (!row) throw notFound("Épisode introuvable");
  return c.json(row);
});

adminRoutes.delete("/episodes/:id", requireOwnershipOrAdmin(loadEpisodeOwner), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const [row] = await db
    .delete(episodes)
    .where(and(eq(episodes.id, c.req.param("id")), eq(episodes.radioId, radioId)))
    .returning();
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
  const radioId = requireRadioId(c.get("radioId"));
  const q = c.req.query("q")?.trim();
  const where = and(
    eq(mixes.radioId, radioId),
    q ? or(ilike(mixes.title, `%${q}%`), ilike(mixes.genre, `%${q}%`)) : undefined,
  );
  return c.json(
    await db.select().from(mixes).where(where).orderBy(mixes.createdAt).limit(listLimit(c)).offset(listOffset(c)),
  );
});

adminRoutes.post("/mixes", requireRole("animateur", "superadmin", "owner"), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const user = c.get("user");
  const body = mixInput.parse(await c.req.json());
  const artistId = isEditorialAdmin(user.role) ? body.artistId ?? null : user.artistId;
  if (!artistId) throw badRequest("artistId requis");
  assertCanActAs(user, artistId);
  const slug = slugify(body.slug || body.title);
  if (await db.query.mixes.findFirst({ where: and(eq(mixes.radioId, radioId), eq(mixes.slug, slug)) }))
    throw conflict("Slug déjà utilisé");
  const [row] = await db
    .insert(mixes)
    .values({
      ...body,
      radioId,
      slug,
      artistId,
      tracklist: body.tracklist ?? [],
      publishedAt: body.publishedAt ? new Date(body.publishedAt) : null,
    })
    .returning();
  return c.json(row, 201);
});

adminRoutes.patch("/mixes/:id", requireOwnershipOrAdmin(loadMixOwner), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const id = c.req.param("id");
  const body = mixInput.partial().parse(await c.req.json());
  const patch: Record<string, unknown> = { ...body, updatedAt: new Date() };
  if (body.slug || body.title) patch.slug = slugify(body.slug || body.title!);
  if (body.publishedAt !== undefined)
    patch.publishedAt = body.publishedAt ? new Date(body.publishedAt) : null;
  const [row] = await db
    .update(mixes)
    .set(patch)
    .where(and(eq(mixes.id, id), eq(mixes.radioId, radioId)))
    .returning();
  if (!row) throw notFound("Mix introuvable");
  return c.json(row);
});

adminRoutes.delete("/mixes/:id", requireOwnershipOrAdmin(loadMixOwner), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const [row] = await db
    .delete(mixes)
    .where(and(eq(mixes.id, c.req.param("id")), eq(mixes.radioId, radioId)))
    .returning();
  if (!row) throw notFound("Mix introuvable");
  return c.json({ ok: true });
});

/* ═══════════════════════ LIBRARY (bibliothèque de pistes du studio) ═══════════════════════
   Pistes libres de droits cataloguées pour le studio de mix. Monté sous
   /v1/admin/library (pour ne pas écraser /v1/admin/tracks/recent = historique
   now-playing). Pas d'ownership par artiste (`artist` est texte libre) : écriture
   = animateur+/superadmin/owner, cloisonnée par radio via le tenant. */

const trackInput = z.object({
  artist: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  genre: z.string().trim().max(80).nullish(),
  bpm: z.number().positive().nullish(),
  durationSec: z.number().int().positive().nullish(),
  source: z.string().trim().max(80).nullish(),
  license: z.string().trim().max(80).nullish(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

adminRoutes.get("/library", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const q = c.req.query("q")?.trim();
  const status = c.req.query("status")?.trim();
  const where = and(
    eq(tracks.radioId, radioId),
    q ? or(ilike(tracks.artist, `%${q}%`), ilike(tracks.title, `%${q}%`), ilike(tracks.genre, `%${q}%`)) : undefined,
    status ? eq(tracks.status, status as "draft" | "published" | "archived") : undefined,
  );
  return c.json(
    await db.select().from(tracks).where(where).orderBy(desc(tracks.createdAt)).limit(listLimit(c)).offset(listOffset(c)),
  );
});

adminRoutes.post("/library", requireRole("animateur", "superadmin", "owner"), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const body = trackInput.parse(await c.req.json());
  const [row] = await db
    .insert(tracks)
    .values({
      ...body,
      radioId,
      status: body.status ?? "draft",
    })
    .returning();
  return c.json(row, 201);
});

adminRoutes.patch("/library/:id", requireRole("animateur", "superadmin", "owner"), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const id = c.req.param("id");
  const body = trackInput.partial().parse(await c.req.json());
  const [row] = await db
    .update(tracks)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(tracks.id, id), eq(tracks.radioId, radioId)))
    .returning();
  if (!row) throw notFound("Piste introuvable");
  return c.json(row);
});

adminRoutes.delete("/library/:id", requireRole("animateur", "superadmin", "owner"), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const [row] = await db
    .delete(tracks)
    .where(and(eq(tracks.id, c.req.param("id")), eq(tracks.radioId, radioId)))
    .returning();
  if (!row) throw notFound("Piste introuvable");
  return c.json({ ok: true });
});

/* ═══════════════════════ USERS (admin de la radio) ═══════════════════════ */

const userPatch = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  role: roleSchema.optional(),
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

/* Un admin ne gère que les comptes de SA radio. L'owner agit dans la radio
   qu'il a sélectionnée (mêmes règles), et peut en plus gérer les autres owners. */
function assertSameRadioOrOwner(actorRole: string, targetRadioId: string | null, radioId: string): void {
  if (actorRole === "owner") return;
  if (targetRadioId !== radioId) throw notFound("Utilisateur introuvable");
}

adminRoutes.get("/users", requireEditorialAdmin, async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const q = c.req.query("q")?.trim();
  const where = and(
    eq(users.radioId, radioId),
    q ? or(ilike(users.email, `%${q}%`), ilike(users.displayName, `%${q}%`)) : undefined,
  );
  const rows = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(users.createdAt)
    .limit(listLimit(c))
    .offset(listOffset(c));
  return c.json(rows.map(publicUser));
});

// Création de compte : mot de passe explicite OU invitation par email.
const userCreateSchema = registerSchema.extend({
  password: registerSchema.shape.password.optional(),
  invite: z.boolean().optional(),
});

adminRoutes.post("/users", requireEditorialAdmin, async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const actor = c.get("user");
  const body = userCreateSchema.parse(await c.req.json());
  assertCanAssignRole(actor, body.role); // anti-escalade : jamais un rôle au-dessus du sien
  // Une fiche animateur liée doit appartenir à la radio du compte (un compte
  // cross-radio — owner/it — n'a pas de radio ni d'artiste).
  if (body.artistId) {
    const targetRadio = isCrossRadio(body.role) ? null : radioId;
    const art = await db.query.artists.findFirst({
      where: eq(artists.id, body.artistId),
      columns: { radioId: true },
    });
    if (!art || art.radioId !== targetRadio) throw badRequest("Fiche animateur d'une autre radio");
  }
  if (await db.query.users.findFirst({ where: eq(users.email, body.email) }))
    throw conflict("Email déjà utilisé");

  const byInvite = body.invite === true || !body.password;
  const rawPassword = body.password ?? randomBytes(24).toString("base64url");

  const [row] = await db
    .insert(users)
    .values({
      // Un compte cross-radio (owner/it) n'appartient à aucune radio ; sinon = la radio courante.
      radioId: isCrossRadio(body.role) ? null : radioId,
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
      subject: "Ton accès à la console",
      html: inviteEmailHtml(row!.displayName, link),
    });
  }

  return c.json({ ...publicUser(row!), invited, emailConfigured: isResendConfigured() }, 201);
});

/* POST /users/:id/invite — (re)génère et envoie un lien d'invitation. */
adminRoutes.post("/users/:id/invite", requireEditorialAdmin, async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const actor = c.get("user");
  const user = await db.query.users.findFirst({ where: eq(users.id, c.req.param("id")) });
  if (!user) throw notFound("Utilisateur introuvable");
  assertSameRadioOrOwner(actor.role, user.radioId, radioId);
  assertCanManageUser(actor, user.role); // pas d'invitation d'un compte de rang supérieur
  const token = await createAuthToken(user.id, "invite", 48 * 60 * 60);
  const link = `${env.ADMIN_BASE_URL.replace(/\/$/, "")}/set-password?token=${token}`;
  const invited = await sendEmail({
    to: user.email,
    subject: "Ton accès à la console",
    html: inviteEmailHtml(user.displayName, link),
  });
  return c.json({ ok: true, invited, emailConfigured: isResendConfigured() });
});

adminRoutes.patch("/users/:id", requireEditorialAdmin, async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const actor = c.get("user");
  const id = c.req.param("id");
  const body = userPatch.parse(await c.req.json());
  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target) throw notFound("Utilisateur introuvable");
  assertSameRadioOrOwner(actor.role, target.radioId, radioId);
  // Anti-escalade : pas de gestion d'un rang supérieur, pas d'attribution au-dessus du sien.
  assertCanManageUser(actor, target.role);
  if (body.role) assertCanAssignRole(actor, body.role);
  // Anti auto-blocage : on ne se désactive pas et on ne se rétrograde pas soi-même.
  if (id === actor.userId && (body.isActive === false || (body.role && RANK[body.role] < RANK[actor.role]))) {
    throw badRequest("Tu ne peux pas te désactiver ni te rétrograder toi-même");
  }
  const patch: Record<string, unknown> = { ...body, updatedAt: new Date() };
  // Invariant : un compte cross-radio (owner/it) a radio_id NULL. On re-dérive
  // radio_id si le rôle change.
  if (body.role) {
    patch.radioId = isCrossRadio(body.role) ? null : isCrossRadio(target.role) ? radioId : target.radioId;
  }
  // Une fiche animateur liée doit appartenir à la radio (effective) du compte.
  if (body.artistId) {
    const effectiveRadio = (patch.radioId as string | null | undefined) ?? target.radioId;
    const art = await db.query.artists.findFirst({
      where: eq(artists.id, body.artistId),
      columns: { radioId: true },
    });
    if (!art || art.radioId !== effectiveRadio) throw badRequest("Fiche animateur d'une autre radio");
  }
  const [row] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
  if (!row) throw notFound("Utilisateur introuvable");
  return c.json(publicUser(row));
});

adminRoutes.delete("/users/:id", requireEditorialAdmin, async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const actor = c.get("user");
  const id = c.req.param("id");
  if (id === actor.userId) throw badRequest("Tu ne peux pas supprimer ton propre compte");
  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target) throw notFound("Utilisateur introuvable");
  assertSameRadioOrOwner(actor.role, target.radioId, radioId);
  assertCanManageUser(actor, target.role); // anti-escalade : pas de suppression d'un rang supérieur
  await db.delete(users).where(eq(users.id, id));
  return c.json({ ok: true });
});

/* ═══════════════════════ SONG REQUESTS (demandes / dédicaces) ═══════════════════════
   File temps-réel des demandes d'auditeurs (POST /v1/requests côté public). La
   lecture est ouverte à tout authentifié (l'animateur voit sa file en direct) ;
   le traitement (PATCH statut) est réservé à l'animateur + aux admins éditoriaux
   (superadmin/owner) — `it` (technique, pas à l'antenne) et `lecteur` sont exclus.
   Toute mutation est tracée par auditMiddleware (entity = "requests"). */

const REQUEST_STATUSES = ["new", "read", "queued", "played", "ignored"] as const;
const requestPatch = z.object({
  status: z.enum(REQUEST_STATUSES),
});

adminRoutes.get("/requests", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const statusParam = c.req.query("status");
  const status =
    statusParam && (REQUEST_STATUSES as readonly string[]).includes(statusParam) ? statusParam : undefined;
  const where = and(
    eq(songRequests.radioId, radioId),
    status ? eq(songRequests.status, status as RequestStatus) : undefined,
  );
  return c.json(
    await db
      .select()
      .from(songRequests)
      .where(where)
      .orderBy(desc(songRequests.createdAt))
      .limit(listLimit(c))
      .offset(listOffset(c)),
  );
});

adminRoutes.patch("/requests/:id", requireRole("animateur", "superadmin", "owner"), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const id = c.req.param("id");
  const body = requestPatch.parse(await c.req.json());
  const user = c.get("user");
  const [row] = await db
    .update(songRequests)
    .set({ status: body.status, handledAt: new Date(), handledBy: user.userId })
    .where(and(eq(songRequests.id, id), eq(songRequests.radioId, radioId)))
    .returning();
  if (!row) throw notFound("Demande introuvable");
  return c.json(row);
});

/* ═══════════════════════ POLLS (sondages en direct) ═══════════════════════
   Sondage temps-réel : l'animateur pose une question à l'antenne, les auditeurs
   votent depuis le site public (POST /v1/polls/:id/vote). Création/fermeture =
   animateur+/superadmin/owner (`it` exclu, pas à l'antenne). Lecture ouverte à
   tout authentifié. Tout est scopé radio. Mutations tracées par auditMiddleware
   (entity = "polls"). */

const pollInput = z.object({
  question: z.string().trim().min(1).max(280),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(6),
  showId: z.string().uuid().nullish(),
  slotId: z.string().uuid().nullish(),
});

adminRoutes.get("/polls", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const statusParam = c.req.query("status");
  const status = statusParam === "active" || statusParam === "closed" ? statusParam : undefined;
  return c.json(
    await db
      .select()
      .from(polls)
      .where(and(eq(polls.radioId, radioId), status ? eq(polls.status, status) : undefined))
      .orderBy(desc(polls.createdAt))
      .limit(listLimit(c))
      .offset(listOffset(c)),
  );
});

adminRoutes.post("/polls", requireRole("animateur", "superadmin", "owner"), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const user = c.get("user");
  const body = pollInput.parse(await c.req.json());
  // Valide l'appartenance du show/slot à la radio (lien optionnel mais sécurisé).
  if (body.showId) {
    const s = await db.query.shows.findFirst({
      where: and(eq(shows.id, body.showId), eq(shows.radioId, radioId)),
      columns: { id: true },
    });
    if (!s) throw badRequest("Émission inconnue");
  }
  if (body.slotId) {
    const s = await db.query.scheduleSlots.findFirst({
      where: and(eq(scheduleSlots.id, body.slotId), eq(scheduleSlots.radioId, radioId)),
      columns: { id: true },
    });
    if (!s) throw badRequest("Créneau inconnu");
  }
  const [row] = await db
    .insert(polls)
    .values({
      radioId,
      question: body.question,
      options: body.options,
      showId: body.showId ?? null,
      slotId: body.slotId ?? null,
      createdBy: user.userId,
      status: "active",
    })
    .returning();
  return c.json(row, 201);
});

/* PATCH /polls/:id — ferme le sondage (status → closed, closedAt). Seule
   mutation gérée : on ne réouvre pas un sondage (un nouveau sondage remplace
   l'ancien). Body optionnel ({ status: "closed" }) pour l'audit. */
adminRoutes.patch("/polls/:id", requireRole("animateur", "superadmin", "owner"), async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const id = c.req.param("id");
  // Body optionnel : on valide seulement qu'il ne demande pas autre chose que closed.
  z.object({ status: z.enum(["closed"]).optional() }).parse(await c.req.json().catch(() => ({})));
  const [row] = await db
    .update(polls)
    .set({ status: "closed", closedAt: new Date() })
    .where(and(eq(polls.id, id), eq(polls.radioId, radioId), eq(polls.status, "active")))
    .returning();
  if (!row) throw notFound("Sondage introuvable (ou déjà fermé)");
  return c.json(row);
});

/* GET /polls/:id/results — dépouillement en direct (tally par option). */
adminRoutes.get("/polls/:id/results", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const id = c.req.param("id");
  const poll = await db.query.polls.findFirst({ where: and(eq(polls.id, id), eq(polls.radioId, radioId)) });
  if (!poll) throw notFound("Sondage introuvable");
  const rows = await db
    .select({ optionIndex: pollVotes.optionIndex, count: sql<number>`count(*)::int` })
    .from(pollVotes)
    .where(and(eq(pollVotes.pollId, id), eq(pollVotes.radioId, radioId)))
    .groupBy(pollVotes.optionIndex);
  const counts = new Map<number, number>();
  let totalVotes = 0;
  for (const r of rows) {
    counts.set(r.optionIndex, r.count);
    totalVotes += r.count;
  }
  const results = poll.options.map((label, i) => ({
    optionIndex: i,
    label,
    count: counts.get(i) ?? 0,
  }));
  return c.json({ results, totalVotes });
});
