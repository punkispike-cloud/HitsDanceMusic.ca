/* Routes publiques (lecture seule, sans token). Filtrées par radio (mur
   multi-tenant) : la radio est résolue depuis l'hôte HTTP (middleware
   publicTenant). En mono-radio, c'est toujours l'unique radio ⇒ zéro drift. */

import { Hono } from "hono";
import { z } from "zod";
import { eq, asc, desc, and, sql, gt } from "drizzle-orm";
import { db } from "../db/client.js";
import { artists, shows, episodes, mixes, trackHistory, trackLikes, songRequests, polls, pollVotes } from "../db/schema.js";
import { notFound, badRequest, tooMany } from "../lib/errors.js";
import { isStripeConfigured } from "../env.js";
import { getScheduleShape, getCurrentSlot, getUpcomingSlotsForArtist, getNextSlot } from "../services/schedule.js";
import { requireRadioId } from "../services/tenant.js";
import { fromMinutes } from "../lib/validation.js";
import type { AppBindings } from "../types.js";

export const publicRoutes = new Hono<AppBindings>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* GET /v1/schedule — format SCHEDULE exact. */
publicRoutes.get("/schedule", async (c) => {
  const shape = await getScheduleShape(requireRadioId(c.get("radioId")));
  c.header("Cache-Control", "public, max-age=60");
  return c.json(shape);
});

/* GET /v1/schedule/now — créneau courant (heure Montréal) + enrichissements
   (animateur, émission, prochain créneau) rétro-compatibles : les champs
   existants sont préservés, on ajoute `artist`, `show`, `next`. */
publicRoutes.get("/schedule/now", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const slot = await getCurrentSlot(radioId);
  c.header("Cache-Control", "public, max-age=30");
  if (!slot) return c.json(null);
  const [artist, show, nextSlot] = await Promise.all([
    slot.artistId
      ? db
          .select({ slug: artists.slug, name: artists.name, photoUrl: artists.photoUrl })
          .from(artists)
          .where(and(eq(artists.id, slot.artistId), eq(artists.radioId, radioId)))
          .limit(1)
      : Promise.resolve([]),
    slot.showId
      ? db
          .select({ slug: shows.slug, title: shows.title })
          .from(shows)
          .where(and(eq(shows.id, slot.showId), eq(shows.radioId, radioId)))
          .limit(1)
      : Promise.resolve([]),
    getNextSlot(radioId),
  ]);
  return c.json({
    from: fromMinutes(slot.startMin),
    to: slot.endMin === 1440 ? "00:00" : fromMinutes(slot.endMin),
    title: slot.title,
    host: slot.hostLabel,
    tag: slot.tag,
    isLive: slot.isLive,
    artist: artist[0] ?? null,
    show: show[0] ?? null,
    next: nextSlot
      ? {
          day: nextSlot.dayOfWeek,
          from: fromMinutes(nextSlot.startMin),
          to: nextSlot.endMin === 1440 ? "00:00" : fromMinutes(nextSlot.endMin),
          title: nextSlot.title,
          host: nextSlot.hostLabel,
          tag: nextSlot.tag,
        }
      : null,
  });
});

/* GET /v1/artists — animateurs publiés, triés. */
publicRoutes.get("/artists", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const rows = await db
    .select()
    .from(artists)
    .where(and(eq(artists.radioId, radioId), eq(artists.isPublished, true)))
    .orderBy(asc(artists.sortOrder), asc(artists.name));
  c.header("Cache-Control", "public, max-age=60");
  return c.json(rows);
});

publicRoutes.get("/artists/:slug", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const row = await db.query.artists.findFirst({
    where: and(
      eq(artists.radioId, radioId),
      eq(artists.slug, c.req.param("slug")),
      eq(artists.isPublished, true),
    ),
  });
  if (!row) throw notFound("Animateur introuvable");
  // Fiche enrichie : ses émissions + ses prochains passages, via les FK réelles.
  const [artistShows, upcoming] = await Promise.all([
    db
      .select()
      .from(shows)
      .where(and(eq(shows.radioId, radioId), eq(shows.artistId, row.id), eq(shows.isPublished, true)))
      .orderBy(asc(shows.sortOrder), asc(shows.title)),
    getUpcomingSlotsForArtist(row.id, radioId),
  ]);
  return c.json({ ...row, shows: artistShows, upcoming });
});

/* GET /v1/shows — émissions publiées. */
publicRoutes.get("/shows", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const rows = await db
    .select()
    .from(shows)
    .where(and(eq(shows.radioId, radioId), eq(shows.isPublished, true)))
    .orderBy(asc(shows.sortOrder), asc(shows.title));
  c.header("Cache-Control", "public, max-age=60");
  return c.json(rows);
});

publicRoutes.get("/shows/:slug", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const row = await db.query.shows.findFirst({
    where: and(eq(shows.radioId, radioId), eq(shows.slug, c.req.param("slug")), eq(shows.isPublished, true)),
  });
  if (!row) throw notFound("Émission introuvable");
  return c.json(row);
});

/* GET /v1/episodes — podcasts publiés. */
publicRoutes.get("/episodes", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const rows = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.radioId, radioId), eq(episodes.status, "published")))
    .orderBy(asc(episodes.publishedAt));
  return c.json(rows);
});

publicRoutes.get("/episodes/:slug", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const row = await db.query.episodes.findFirst({
    where: and(
      eq(episodes.radioId, radioId),
      eq(episodes.slug, c.req.param("slug")),
      eq(episodes.status, "published"),
    ),
  });
  if (!row) throw notFound("Épisode introuvable");
  return c.json(row);
});

/* GET /v1/mixes — mixes publiés. */
publicRoutes.get("/mixes", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const rows = await db
    .select()
    .from(mixes)
    .where(and(eq(mixes.radioId, radioId), eq(mixes.status, "published")))
    .orderBy(asc(mixes.publishedAt));
  return c.json(rows);
});

publicRoutes.get("/mixes/:slug", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const row = await db.query.mixes.findFirst({
    where: and(eq(mixes.radioId, radioId), eq(mixes.slug, c.req.param("slug")), eq(mixes.status, "published")),
  });
  if (!row) throw notFound("Mix introuvable");
  return c.json(row);
});

/* ───────── Historique public des titres + 🤘 j'aime ─────────
   Réutilise le poller track-history (services/track-history.ts). Likes anonymes
   par client_id (même UUID que presence/analytics). Tout scopé à la radio. */

function readClientId(c: { req: { query: (k: string) => string | undefined } }): string {
  const id = (c.req.query("clientId") ?? "").trim();
  if (!id || id.length > 64) throw badRequest("clientId manquant ou invalide");
  return id;
}

async function likeCount(trackId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(trackLikes)
    .where(eq(trackLikes.trackId, trackId));
  return r?.n ?? 0;
}

/* GET /v1/tracks/recent?limit=50 — derniers titres joués + compteur de likes. */
publicRoutes.get("/tracks/recent", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 50));
  const rows = await db
    .select({
      id: trackHistory.id,
      artist: trackHistory.artist,
      title: trackHistory.title,
      playedAt: trackHistory.playedAt,
      likes: sql<number>`count(${trackLikes.id})::int`,
    })
    .from(trackHistory)
    .leftJoin(trackLikes, eq(trackLikes.trackId, trackHistory.id))
    .where(eq(trackHistory.radioId, radioId))
    .groupBy(trackHistory.id)
    .orderBy(desc(trackHistory.playedAt))
    .limit(limit);
  c.header("Cache-Control", "public, max-age=15");
  return c.json(rows);
});

/* POST /v1/tracks/:id/like?clientId=… — aime un titre (idempotent). */
publicRoutes.post("/tracks/:id/like", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const trackId = c.req.param("id");
  if (!UUID_RE.test(trackId)) throw notFound("Titre introuvable");
  const clientId = readClientId(c);
  const track = await db.query.trackHistory.findFirst({
    where: and(eq(trackHistory.id, trackId), eq(trackHistory.radioId, radioId)),
  });
  if (!track) throw notFound("Titre introuvable");
  await db.insert(trackLikes).values({ radioId, trackId, clientId }).onConflictDoNothing();
  return c.json({ liked: true, likes: await likeCount(trackId) });
});

/* DELETE /v1/tracks/:id/like?clientId=… — retire son like. */
publicRoutes.delete("/tracks/:id/like", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const trackId = c.req.param("id");
  if (!UUID_RE.test(trackId)) throw notFound("Titre introuvable");
  const clientId = readClientId(c);
  await db
    .delete(trackLikes)
    .where(
      and(eq(trackLikes.radioId, radioId), eq(trackLikes.trackId, trackId), eq(trackLikes.clientId, clientId)),
    );
  return c.json({ liked: false, likes: await likeCount(trackId) });
});

/* ───────────────────────── song_requests (demandes / dédicaces) ─────────────────────────
   Le site public pousse ici (POST /v1/requests) au lieu d'ouvrir un mailto:. La
   radio est résolue par publicTenant (hôte HTTP) ; tout est scopé radio. Rate-limit
   global (par IP) + garde anti-flood par clientId (≤ 5 demandes / min) + honeypot
   (_hp) côté serveur. ⚖️ Rétention Loi 25 gérée par services/maintenance.ts. */

const requestInput = z.object({
  clientId: z
    .string()
    .trim()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "clientId invalide"),
  artist: z.string().trim().max(200).default(""),
  title: z.string().trim().min(1).max(200),
  dedication: z.string().trim().max(500).nullish(),
  requesterName: z.string().trim().max(120).nullish(),
  showId: z.string().uuid().nullish(),
  slotId: z.string().uuid().nullish(),
  _hp: z.string().optional(), // honeypot (champ invisible côté site)
});

/* POST /v1/requests — dépose une demande dans la file animateur. */
publicRoutes.post("/requests", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const body = requestInput.parse(await c.req.json());

  // Honeypot : un bot qui remplit le champ invisible → on simule un succès sans
  // rien stocker (ne pas le signaler, pour ne pas instruire les bots).
  if (body._hp && body._hp.trim() !== "") return c.json({ ok: true }, 201);

  // Anti-flood par clientId : max 5 demandes / minute (complément du rate-limit IP).
  const since = new Date(Date.now() - 60_000);
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(songRequests)
    .where(and(eq(songRequests.radioId, radioId), eq(songRequests.clientId, body.clientId), gt(songRequests.createdAt, since)));
  if ((recent?.n ?? 0) >= 5) {
    c.header("Retry-After", "60");
    throw tooMany("Trop de demandes, réessaie dans un instant");
  }

  const [row] = await db
    .insert(songRequests)
    .values({
      radioId,
      clientId: body.clientId,
      artist: body.artist,
      title: body.title,
      dedication: body.dedication ?? null,
      requesterName: body.requesterName ?? null,
      showId: body.showId ?? null,
      slotId: body.slotId ?? null,
      status: "new",
    })
    .returning();
  return c.json({ ok: true, id: row?.id ?? null }, 201);
});

/* ───────────────────────── polls (sondages en direct) ─────────────────────────
   Sondage temps-réel posé par l'animateur (créé via /v1/admin/polls). Le site
   public récupère le sondage actif (GET /v1/polls/active) et vote (POST
   /v1/polls/:id/vote). Radio résolue par publicTenant (hôte HTTP). Rate-limit
   global (par IP) + garde anti-flood par clientId (≤ 20 votes / min). Vote
   idempotent : la contrainte unique (pollId, clientId) bloque les doublons et
   l'endpoint renvoie le vote existant sur conflit. */

const voteInput = z.object({
  clientId: z
    .string()
    .trim()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "clientId invalide"),
  optionIndex: z.number().int().min(0),
});

/* GET /v1/polls/active?clientId=… — sondage actif de la radio + dépouillement
   en direct. `clientId` optionnel → renvoie `myVote` (l'option du client) pour
   que le widget affiche son choix. null si aucun sondage actif. */
publicRoutes.get("/polls/active", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const clientId = c.req.query("clientId")?.trim() || null;
  const poll = await db.query.polls.findFirst({
    where: and(eq(polls.radioId, radioId), eq(polls.status, "active")),
    orderBy: desc(polls.createdAt),
  });
  if (!poll) return c.json(null);

  const rows = await db
    .select({ optionIndex: pollVotes.optionIndex, count: sql<number>`count(*)::int` })
    .from(pollVotes)
    .where(and(eq(pollVotes.pollId, poll.id), eq(pollVotes.radioId, radioId)))
    .groupBy(pollVotes.optionIndex);
  const counts = new Map<number, number>();
  let totalVotes = 0;
  for (const r of rows) {
    counts.set(r.optionIndex, r.count);
    totalVotes += r.count;
  }

  let myVote: number | null = null;
  if (clientId) {
    const [v] = await db
      .select({ optionIndex: pollVotes.optionIndex })
      .from(pollVotes)
      .where(
        and(
          eq(pollVotes.pollId, poll.id),
          eq(pollVotes.radioId, radioId),
          eq(pollVotes.clientId, clientId),
        ),
      );
    myVote = v ? v.optionIndex : null;
  }

  c.header("Cache-Control", "public, max-age=3");
  return c.json({
    id: poll.id,
    question: poll.question,
    options: poll.options,
    showId: poll.showId,
    slotId: poll.slotId,
    createdAt: poll.createdAt,
    results: poll.options.map((label, i) => ({ optionIndex: i, label, count: counts.get(i) ?? 0 })),
    totalVotes,
    myVote,
  });
});

/* POST /v1/polls/:id/vote — vote anonyme (idempotent sur la contrainte unique). */
publicRoutes.post("/polls/:id/vote", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const id = c.req.param("id");
  const body = voteInput.parse(await c.req.json());
  const poll = await db.query.polls.findFirst({
    where: and(eq(polls.id, id), eq(polls.radioId, radioId), eq(polls.status, "active")),
  });
  if (!poll) throw notFound("Sondage introuvable ou fermé");
  if (body.optionIndex >= poll.options.length) throw badRequest("Option invalide");

  // Anti-flood par clientId : max 20 votes / minute (complément du rate-limit IP).
  // La contrainte unique (pollId, clientId) rend déjà le re-vote idempotent.
  const since = new Date(Date.now() - 60_000);
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pollVotes)
    .where(
      and(eq(pollVotes.radioId, radioId), eq(pollVotes.clientId, body.clientId), gt(pollVotes.createdAt, since)),
    );
  if ((recent?.n ?? 0) >= 20) {
    c.header("Retry-After", "60");
    throw tooMany("Trop de votes, réessaie dans un instant");
  }

  // Idempotent : sur conflit (pollId, clientId) on ne crée pas de doublon.
  await db
    .insert(pollVotes)
    .values({ radioId, pollId: id, clientId: body.clientId, optionIndex: body.optionIndex })
    .onConflictDoNothing();

  // Renvoie le vote effectif (nouveau ou existant) : si l'auditeur re-vote une
  // autre option, son 1er choix est verrouillé (contrainte unique) — on l'indique.
  const [vote] = await db
    .select({ optionIndex: pollVotes.optionIndex })
    .from(pollVotes)
    .where(
      and(
        eq(pollVotes.pollId, id),
        eq(pollVotes.radioId, radioId),
        eq(pollVotes.clientId, body.clientId),
      ),
    );
  return c.json({ voted: true, optionIndex: vote?.optionIndex ?? body.optionIndex }, 201);
});

/* ═══════════════════════ WEBHOOK STRIPE (facturation) ═══════════════════════
   Réception des événements Stripe (abonnements). SÉCURITAIRE : tant que la lib
   `stripe` + STRIPE_WEBHOOK_SECRET ne sont pas branchés, on n'accepte NI ne traite
   aucun événement (ne jamais traiter un payload non vérifié). Quand le secret est
   posé mais la lib absente, on répond 501 (scaffold) pour ne pas faire croire à
   Stripe que c'est livré. Branchement complet = ROADMAP Phase 5. */
publicRoutes.post("/webhooks/stripe", async (c) => {
  if (!isStripeConfigured()) {
    return c.json(
      { error: { code: "stripe_disabled", message: "Webhook Stripe non configuré (STRIPE_WEBHOOK_SECRET absent)" } },
      503,
    );
  }
  // TODO(Phase 5) : vérifier la signature avec stripe.webhooks.constructEvent(
  //   rawBody, sig, STRIPE_WEBHOOK_SECRET), puis mettre à jour subscriptions
  //   (status / current_period_end) selon l'event (invoice.paid, customer.subscription.*).
  return c.json({ error: { code: "not_implemented", message: "Webhook Stripe scaffoldé, lib stripe à brancher" } }, 501);
});
