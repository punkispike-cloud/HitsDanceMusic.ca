/* Schéma de base de données (source de vérité unique).
   Conventions : PK uuid (gen_random_uuid()), snake_case en DB,
   created_at/updated_at en timestamptz, FK avec onDelete explicite. */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  smallint,
  doublePrecision,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/* ───────────────────────── Enums ───────────────────────── */

// `it` = technique cross-radio (monitoring parc, sans droit éditorial).
export const userRole = pgEnum("user_role", ["owner", "superadmin", "animateur", "lecteur", "it"]);

// Cycle de vie d'une radio cliente dans le parc (multi-tenant).
export const radioStatus = pgEnum("radio_status", ["active", "provisioning", "paused"]);

// Calque exact de SLOT_TAGS (js/schedule.js:8-16)
export const slotTag = pgEnum("slot_tag", [
  "morning",
  "hitlist",
  "drive",
  "limelight",
  "night",
  "special",
  "audition",
]);

export const contentStatus = pgEnum("content_status", ["draft", "published", "archived"]);

export const uploadKind = pgEnum("upload_kind", ["episode", "mix", "cover", "track"]);
export const uploadStatus = pgEnum("upload_status", ["pending", "completed", "aborted"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/* ───────────────────────── radios (tenants) ─────────────────────────
   Registre des radios clientes (multi-tenant). Chaque ligne = une radio.
   `slug` = la marque (= SEED_BRAND : hitsdance, rockradio, …). Le contenu de
   chaque radio sera cloisonné par `radio_id` (ajouté ensuite aux tables). */

export const radios = pgTable(
  "radios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(), // = SEED_BRAND
    name: text("name").notNull(),
    status: radioStatus("status").notNull().default("provisioning"),
    plan: text("plan"), // starter | growth | pro… (facturation tenue hors dépôt)
    domains: jsonb("domains").notNull().default(sql`'[]'::jsonb`), // hôtes du site public
    streamUrl: text("stream_url"), // flux audio (AzuraCast/Icecast ou externe)
    nowPlayingUrl: text("now_playing_url"), // now-playing de la station
    billingNote: text("billing_note"),
    monthlyPrice: integer("monthly_price"), // $ / mois (suivi MRR)
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    licenseConfirmed: boolean("license_confirmed").notNull().default(false), // SOCAN/Re:Sound reçues
    // Surveillance du flux (dead-air / injoignable) — alimenté par services/monitor.ts.
    healthStatus: text("health_status").notNull().default("unknown"), // up | down | silent | unknown
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastAlertAt: timestamp("last_alert_at", { withTimezone: true }),
    lastAlertKind: text("last_alert_kind"), // down | silent
    // Outil de distribution : état cochable des inscriptions externes (TuneIn,
    // Radio Garden, Alexa, podcasts…). jsonb merge côté API. Pas de schéma strict
    // → évolutif sans migration. {} par défaut.
    distribution: jsonb("distribution").notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (t) => ({
    slugIdx: uniqueIndex("radios_slug_idx").on(t.slug),
  }),
);

/* ───────────────────────── artists (animateurs / DJs) ───────────────────────── */

export const artists = pgTable(
  "artists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    photoUrl: text("photo_url"),
    initials: text("initials"),
    showTitle: text("show_title"),
    scheduleText: text("schedule_text"),
    bio: text("bio"),
    socials: jsonb("socials").notNull().default(sql`'{}'::jsonb`),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    slugIdx: uniqueIndex("artists_slug_idx").on(t.radioId, t.slug),
    sortIdx: index("artists_sort_idx").on(t.sortOrder),
    radioIdx: index("artists_radio_idx").on(t.radioId),
  }),
);

/* ───────────────────────── users ───────────────────────── */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // null = compte `owner` (En Ondes, cross-radio) ; sinon = radio de rattachement.
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    role: userRole("role").notNull().default("lecteur"),
    // Lie un compte « animateur » à sa fiche artiste (ownership RBAC).
    artistId: uuid("artist_id").references(() => artists.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
    artistIdx: index("users_artist_id_idx").on(t.artistId),
    radioIdx: index("users_radio_idx").on(t.radioId),
  }),
);

/* ───────────────────────── refresh_tokens ─────────────────────────
   On stocke le SHA-256 du token, jamais le brut : une fuite DB ne
   donne pas de tokens utilisables. Rotation via replaced_by. */

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedBy: uuid("replaced_by"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("refresh_user_idx").on(t.userId),
    hashIdx: uniqueIndex("refresh_token_hash_idx").on(t.tokenHash),
    expiresIdx: index("refresh_expires_idx").on(t.expiresAt),
  }),
);

/* ───────────────────────── shows (émissions) ───────────────────────── */

export const shows = pgTable(
  "shows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    tag: slotTag("tag"),
    badge: text("badge"),
    artistId: uuid("artist_id").references(() => artists.id, { onDelete: "set null" }),
    scheduleText: text("schedule_text"),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    slugIdx: uniqueIndex("shows_slug_idx").on(t.radioId, t.slug),
    artistIdx: index("shows_artist_idx").on(t.artistId),
    tagIdx: index("shows_tag_idx").on(t.tag),
    radioIdx: index("shows_radio_idx").on(t.radioId),
  }),
);

/* ───────────────────────── schedule_slots (source de SCHEDULE) ─────────────────────────
   Minutes depuis minuit (0..1440) : le front compare en minutes et gère
   "24:00" (=1440). L'API re-sérialise en "HH:MM" pour matcher SCHEDULE. */

export const scheduleSlots = pgTable(
  "schedule_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    dayOfWeek: smallint("day_of_week").notNull(), // 0=dimanche .. 6=samedi
    startMin: smallint("start_min").notNull(),
    endMin: smallint("end_min").notNull(),
    title: text("title").notNull(),
    hostLabel: text("host_label").notNull(),
    tag: slotTag("tag").notNull(),
    showId: uuid("show_id").references(() => shows.id, { onDelete: "set null" }),
    artistId: uuid("artist_id").references(() => artists.id, { onDelete: "set null" }),
    isLive: boolean("is_live").notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    dayIdx: index("schedule_day_idx").on(t.dayOfWeek, t.startMin),
    showIdx: index("schedule_show_idx").on(t.showId),
    artistIdx: index("schedule_artist_idx").on(t.artistId),
    dayChk: check("schedule_day_chk", sql`${t.dayOfWeek} BETWEEN 0 AND 6`),
    rangeChk: check("schedule_range_chk", sql`${t.startMin} < ${t.endMin} AND ${t.endMin} <= 1440`),
    radioIdx: index("schedule_radio_idx").on(t.radioId),
  }),
);

/* ───────────────────────── episodes (podcasts) ───────────────────────── */

export const episodes = pgTable(
  "episodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    showId: uuid("show_id").references(() => shows.id, { onDelete: "set null" }),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    audioUrl: text("audio_url"),
    audioKey: text("audio_key"),
    durationSec: integer("duration_sec"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    coverUrl: text("cover_url"),
    season: integer("season"),
    episodeNumber: integer("episode_number"),
    status: contentStatus("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    tags: text("tags").array(),
    ...timestamps,
  },
  (t) => ({
    slugIdx: uniqueIndex("episodes_slug_idx").on(t.radioId, t.slug),
    artistIdx: index("episodes_artist_idx").on(t.artistId),
    showIdx: index("episodes_show_idx").on(t.showId),
    statusIdx: index("episodes_status_published_idx").on(t.status, t.publishedAt),
    radioIdx: index("episodes_radio_idx").on(t.radioId),
  }),
);

/* ───────────────────────── mixes (DJ sets) ───────────────────────── */

export const mixes = pgTable(
  "mixes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    genre: text("genre"),
    audioUrl: text("audio_url"),
    audioKey: text("audio_key"),
    durationSec: integer("duration_sec"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    coverUrl: text("cover_url"),
    // tracklist : [{ pos, artist, title, timestamp }]
    tracklist: jsonb("tracklist").notNull().default(sql`'[]'::jsonb`),
    status: contentStatus("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    tags: text("tags").array(),
    ...timestamps,
  },
  (t) => ({
    slugIdx: uniqueIndex("mixes_slug_idx").on(t.radioId, t.slug),
    artistIdx: index("mixes_artist_idx").on(t.artistId),
    statusIdx: index("mixes_status_idx").on(t.status),
    radioIdx: index("mixes_radio_idx").on(t.radioId),
  }),
);

/* ───────────────────────── featured_items (éditorial « À la une ») ─────────────────────────
   Cartes homepage + items du rail news. Éditables depuis l'admin ; le site public
   lit GET /v1/featured (homepage) et kind=rail pour le rail. */

export const featuredKind = pgEnum("featured_kind", ["homepage", "rail"]);

export const featuredItems = pgTable(
  "featured_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    kind: featuredKind("kind").notNull().default("homepage"),
    tag: text("tag"),
    title: text("title").notNull(),
    meta: text("meta"),
    body: text("body"),
    coverUrl: text("cover_url"),
    emoji: text("emoji"),
    linkUrl: text("link_url"),
    variant: text("variant"), // drive | jumpoff | oksana | default
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    radioKindIdx: index("featured_items_radio_kind_idx").on(t.radioId, t.kind, t.sortOrder),
    radioIdx: index("featured_items_radio_idx").on(t.radioId),
  }),
);

/* ───────────────────────── tracks (bibliothèque de pistes) ─────────────────────────
   Pistes libres de droits cataloguées pour le studio de mix (et plus tard la
   rotation AzuraCast). Audio stocké sur S3/R2. `source`/`license` = journal de
   conformité (CC0/CC-BY/Pixabay/permission). `artist` est texte libre (les
   artistes libres de droits ne sont pas dans la table `artists`). */

export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    artist: text("artist").notNull(),
    title: text("title").notNull(),
    genre: text("genre"),
    bpm: doublePrecision("bpm"),
    durationSec: integer("duration_sec"),
    audioUrl: text("audio_url"),
    audioKey: text("audio_key"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    source: text("source"), // FMA / Pixabay / Bandcamp / Internet Archive / …
    license: text("license"), // CC0 / CC-BY / Pixabay / permission
    status: contentStatus("status").notNull().default("draft"),
    ...timestamps,
  },
  (t) => ({
    radioIdx: index("tracks_radio_idx").on(t.radioId),
    statusIdx: index("tracks_status_idx").on(t.status),
    artistIdx: index("tracks_artist_idx").on(t.artist),
  }),
);

/* ───────────────────────── upload_intents (traçabilité S3 pré-signé) ───────────────────────── */

export const uploadIntents = pgTable(
  "upload_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: uploadKind("kind").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    maxBytes: bigint("max_bytes", { mode: "number" }).notNull(),
    status: uploadStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("upload_intents_user_idx").on(t.userId),
    radioIdx: index("upload_intents_radio_idx").on(t.radioId),
  }),
);

/* ───────────────────────── analytics_sessions (audience) ─────────────────────────
   Une ligne par visiteur (client_id stable, le même UUID que presence).
   active_sec = temps passé sur le site ; listen_sec = temps d'écoute total.
   ⚖️ Contient l'IP (donnée personnelle, Loi 25) — prévoir mention + rétention. */

export const analyticsSessions = pgTable(
  "analytics_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    ip: text("ip"),
    ipCountry: text("ip_country"),
    ipLat: doublePrecision("ip_lat"),
    ipLon: doublePrecision("ip_lon"),
    userAgent: text("user_agent"),
    device: text("device"),
    browser: text("browser"),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    // Horodatage du DERNIER beacon ayant réellement crédité du temps, par nature
    // de temps. Sert à plafonner chaque incrément au temps écoulé depuis lui :
    // deux fenêtres ouvertes en parallèle partagent le même client_id et
    // gonflaient sinon les compteurs (2 × le temps réel). Deux colonnes plutôt
    // qu'une : sans ça, un heartbeat d'une fenêtre « mangerait » la seconde
    // d'écoute que la fenêtre qui joue s'apprêtait à créditer.
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    lastListenAt: timestamp("last_listen_at", { withTimezone: true }),
    activeSec: integer("active_sec").notNull().default(0),
    listenSec: integer("listen_sec").notNull().default(0),
    pageViews: integer("page_views").notNull().default(0),
  },
  (t) => ({
    clientIdx: uniqueIndex("analytics_sessions_client_idx").on(t.radioId, t.clientId),
    lastSeenIdx: index("analytics_sessions_last_seen_idx").on(t.lastSeen),
    radioIdx: index("analytics_sessions_radio_idx").on(t.radioId),
  }),
);

/* ───────────────────────── analytics_daily (ventilation par jour) ─────────────────────────
   Une ligne par (radio, jour, visiteur). Indispensable parce que
   analytics_sessions est un CUMUL DE VIE par visiteur : en grouper les totaux
   par first_seen attribuait à un seul jour — celui de la première visite — tout
   ce que la personne a écouté depuis (un auditeur fidèle depuis mars n'apparaît
   jamais sur les jours récents). Ici chaque beacon crédite le jour où il arrive.

   Le jour est calculé au fuseau de la radio (America/Toronto), comme le reste des
   agrégats de analytics-admin.ts, pour que « aujourd'hui » veuille dire la même
   chose partout. Aucune donnée personnelle (ni IP, ni user-agent) : purgé avec le
   reste de l'analytics par le job de rétention. */

export const analyticsDaily = pgTable(
  "analytics_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    clientId: text("client_id").notNull(),
    activeSec: integer("active_sec").notNull().default(0),
    listenSec: integer("listen_sec").notNull().default(0),
    pageViews: integer("page_views").notNull().default(0),
  },
  (t) => ({
    dayClientIdx: uniqueIndex("analytics_daily_day_client_idx").on(t.radioId, t.day, t.clientId),
    dayIdx: index("analytics_daily_day_idx").on(t.radioId, t.day),
  }),
);

/* ───────────────────────── analytics_show_listen (temps par émission) ─────────────────────────
   Agrégat par (émission, visiteur) → permet total ET moyenne par auditeur. */

export const analyticsShowListen = pgTable(
  "analytics_show_listen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    showTitle: text("show_title").notNull(),
    clientId: text("client_id").notNull(),
    listenSec: integer("listen_sec").notNull().default(0),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairIdx: uniqueIndex("analytics_show_listen_pair_idx").on(t.radioId, t.showTitle, t.clientId),
    showIdx: index("analytics_show_listen_show_idx").on(t.showTitle),
    radioIdx: index("analytics_show_listen_radio_idx").on(t.radioId),
  }),
);

/* ───────────────────────── track_history (titres diffusés) ─────────────────────────
   Historique des titres passés à l'antenne. Alimenté par un poller qui interroge
   le now-playing du flux et enregistre chaque changement de titre. */

export const trackHistory = pgTable(
  "track_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    artist: text("artist").notNull().default(""),
    title: text("title").notNull(),
    playedAt: timestamp("played_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    playedAtIdx: index("track_history_played_at_idx").on(t.playedAt),
    radioIdx: index("track_history_radio_idx").on(t.radioId),
  }),
);

/* ───────────────────────── track_likes (🤘 j'aime un titre) ─────────────────────────
   Un like par (titre, visiteur). client_id = même UUID stable que presence/analytics.
   Anonyme, sans compte. Sert au compteur public + au feedback de programmation. */

export const trackLikes = pgTable(
  "track_likes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => trackHistory.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqIdx: uniqueIndex("track_likes_uniq_idx").on(t.trackId, t.clientId),
    radioIdx: index("track_likes_radio_idx").on(t.radioId),
    trackIdx: index("track_likes_track_idx").on(t.trackId),
  }),
);

/* ───────────────────────── song_requests (demandes de titres / dédicaces) ─────────────────────────
   File temps-réel des demandes d'auditeurs. Alimentée par le site public
   (POST /v1/requests) et traitée par l'animateur en direct (page DemandeS /
   future page Studio). client_id = même UUID stable que presence/analytics.
   Cycle de vie : new → read → queued → played (ou ignored). ⚖️ dedication et
   requester_name = données potentiellement personnelles → purgées au-delà de
   ANALYTICS_RETENTION_DAYS par services/maintenance.ts (Loi 25). */

export const requestStatus = pgEnum("request_status", ["new", "read", "queued", "played", "ignored"]);

export const songRequests = pgTable(
  "song_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    artist: text("artist").notNull().default(""),
    title: text("title").notNull(),
    dedication: text("dedication"),
    requesterName: text("requester_name"),
    showId: uuid("show_id").references(() => shows.id, { onDelete: "set null" }),
    slotId: uuid("slot_id").references(() => scheduleSlots.id, { onDelete: "set null" }),
    status: requestStatus("status").notNull().default("new"),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    handledBy: uuid("handled_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inboxIdx: index("song_requests_inbox_idx").on(t.radioId, t.status, t.createdAt),
    radioIdx: index("song_requests_radio_idx").on(t.radioId),
  }),
);

/* ───────────────────────── polls (sondages en direct) ─────────────────────────
   Sondage temps-réel lié optionnellement à une émission/créneau. `options` =
   tableau des choix (text[]). status active|closed. Un auditeur vote
   anonymement par client_id (même UUID stable que presence/analytics) — un seul
   vote par (poll, client) via uniqueIndex. createdBy = l'animateur qui a créé
   le sondage (effacé si le compte est supprimé). */

export const pollStatus = pgEnum("poll_status", ["active", "closed"]);

export const polls = pgTable(
  "polls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    showId: uuid("show_id").references(() => shows.id, { onDelete: "set null" }),
    slotId: uuid("slot_id").references(() => scheduleSlots.id, { onDelete: "set null" }),
    question: text("question").notNull(),
    options: text("options").array().notNull(),
    status: pollStatus("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    radioStatusIdx: index("polls_radio_status_idx").on(t.radioId, t.status),
    radioIdx: index("polls_radio_idx").on(t.radioId),
  }),
);

/* ───────────────────────── poll_votes (votes anonymes) ─────────────────────────
   Un vote = (poll, client_id). uniqueIndex (pollId, clientId) → idempotence :
   re-voter le même sondage ne crée pas de doublon (le endpoint public renvoie
   le vote existant sur conflit). option_index = index dans polls.options. */

export const pollVotes = pgTable(
  "poll_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    pollId: uuid("poll_id")
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    optionIndex: integer("option_index").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pollClientIdx: uniqueIndex("poll_votes_poll_client_idx").on(t.pollId, t.clientId),
    radioIdx: index("poll_votes_radio_idx").on(t.radioId),
  }),
);

/* ───────────────────────── push_subscriptions (rappels d'émission) ─────────────────────────
   Abonnement Web Push (PushSubscription du navigateur). showSlug null = tous
   les rappels ; sinon limité à une émission. client_id = même UUID que presence/analytics. */

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    clientId: text("client_id"),
    showSlug: text("show_slug"), // null = tous les rappels
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
  },
  (t) => ({
    endpointIdx: uniqueIndex("push_subscriptions_endpoint_idx").on(t.radioId, t.endpoint),
    showIdx: index("push_subscriptions_show_idx").on(t.showSlug),
    radioIdx: index("push_subscriptions_radio_idx").on(t.radioId),
  }),
);

/* ───────────────────────── auth_tokens (reset mdp + invitation) ─────────────────────────
   Jeton à usage unique, haché en DB (jamais le brut). purpose distingue
   « invite » (1er mot de passe) de « reset » (mot de passe oublié). */

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    purpose: text("purpose").notNull(), // invite | reset
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hashIdx: uniqueIndex("auth_tokens_hash_idx").on(t.tokenHash),
    userIdx: index("auth_tokens_user_idx").on(t.userId),
  }),
);

/* ───────────────────────── audit_log (traçabilité admin) ─────────────────────────
   Une ligne par mutation admin (create/update/delete). On fige un instantané
   de l'acteur (email/nom) pour que la trace survive à la suppression du compte. */

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id"), // pas de FK : la trace doit survivre à la suppression
    actorEmail: text("actor_email"),
    actorName: text("actor_name"),
    actorRole: text("actor_role"),
    action: text("action").notNull(), // create | update | delete
    entity: text("entity").notNull(), // artists | shows | schedule-slots | episodes | mixes | users
    entityId: text("entity_id"),
    summary: jsonb("summary").notNull().default(sql`'{}'::jsonb`),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("audit_log_created_idx").on(t.createdAt),
    entityIdx: index("audit_log_entity_idx").on(t.entity, t.entityId),
    radioIdx: index("audit_log_radio_idx").on(t.radioId),
  }),
);

/* ───────────────────────── report_log (rapports mensuels envoyés) ─────────────────────────
   Idempotence des rapports auto : une ligne par (radio, période "YYYY-MM") déjà
   envoyée ⇒ jamais de doublon, même si le job tourne plusieurs fois dans le mois. */

export const reportLog = pgTable(
  "report_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id")
      .notNull()
      .references(() => radios.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // "2026-05"
    recipients: text("recipients"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqIdx: uniqueIndex("report_log_uniq_idx").on(t.radioId, t.period),
  }),
);

/* ───────────────────────── rate_buckets (rate-limit auth DB — C1.3) ─────────────────────────
   Compteur de fenêtre par minute pour le rate-limit des endpoints /auth/* (anti
   brute-force), partagé entre instances via Postgres. `key` = `auth:<ip>:<minute>`.
   Une ligne par fenêtre → upsert atomique (count + 1) ; purge des lignes expirées
   par le job d'entretien (services/maintenance.ts). */

export const rateBuckets = pgTable(
  "rate_buckets",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    expIdx: index("rate_buckets_expires_idx").on(t.expiresAt),
  }),
);

/* ═══════════════════ Auditeurs (comptes grand public — catalogue à la demande) ═══════════════════
   Séparés de `users` (staff RBAC) : un auditeur du hub En Ondes n'a AUCUN accès
   admin/éditorial. Cross-radio (le catalogue est commun au réseau En Ondes).
   Auth propre (JWT « listener » + refresh dédié), miroir de l'auth staff. */

export const listeners = pgTable(
  "listeners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    emailIdx: uniqueIndex("listeners_email_idx").on(t.email),
  }),
);

export const listenerRefreshTokens = pgTable(
  "listener_refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listenerId: uuid("listener_id")
      .notNull()
      .references(() => listeners.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedBy: uuid("replaced_by"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    listenerIdx: index("listener_refresh_listener_idx").on(t.listenerId),
    tokenIdx: index("listener_refresh_token_idx").on(t.tokenHash),
  }),
);

/* Playlists possédées par un auditeur (privées par défaut). */
export const playlists = pgTable(
  "playlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listenerId: uuid("listener_id")
      .notNull()
      .references(() => listeners.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isPublic: boolean("is_public").notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    listenerIdx: index("playlists_listener_idx").on(t.listenerId),
  }),
);

/* Pistes d'une playlist (ordonnées). Une piste au plus une fois par playlist. */
export const playlistTracks = pgTable(
  "playlist_tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playlistId: uuid("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqIdx: uniqueIndex("playlist_tracks_uniq_idx").on(t.playlistId, t.trackId),
    posIdx: index("playlist_tracks_pos_idx").on(t.playlistId, t.position),
  }),
);

/* Favoris (« j'aime ») d'un auditeur sur une piste du catalogue. */
export const listenerFavorites = pgTable(
  "listener_favorites",
  {
    listenerId: uuid("listener_id")
      .notNull()
      .references(() => listeners.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.listenerId, t.trackId] }),
    trackIdx: index("listener_favorites_track_idx").on(t.trackId),
  }),
);

/* Écoutes à la demande (beacon de lecture). Alimente l'historique auditeur,
   les tendances (plus écoutées sur N jours) et les recommandations. listenerId
   NULL = écoute anonyme (visiteur non connecté). Purgeable (Loi 25). */
export const trackPlays = pgTable(
  "track_plays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    listenerId: uuid("listener_id").references(() => listeners.id, { onDelete: "set null" }),
    playedAt: timestamp("played_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    trackIdx: index("track_plays_track_idx").on(t.trackId),
    playedIdx: index("track_plays_played_idx").on(t.playedAt),
    listenerIdx: index("track_plays_listener_idx").on(t.listenerId),
  }),
);

/* ═══════════════════ Pubs / jingles (média + rotation) ═══════════════════
   Bibliothèque de médias (jingles, pubs, intros, outros, beds) + plan de rotation
   par fenêtre horaire. L'audio vit sur S3/R2 (comme tracks/episodes) ; la rotation
   est consommée par AzuraCast (playlists/rotate) ou Liquidsoap — la synchro est
   assurée par services/azuracast.ts (gated par AZURACAST_BASE_URL). */

export const mediaAssetKind = pgEnum("media_asset_kind", ["jingle", "ad", "intro", "outro", "bed"]);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    kind: mediaAssetKind("kind").notNull().default("jingle"),
    name: text("name").notNull(),
    audioUrl: text("audio_url"),
    durationSec: integer("duration_sec"),
    status: contentStatus("status").notNull().default("draft"),
    ...timestamps,
  },
  (t) => ({
    radioIdx: index("media_assets_radio_idx").on(t.radioId),
  }),
);

export const adRotations = pgTable(
  "ad_rotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").references(() => mediaAssets.id, { onDelete: "cascade" }),
    weight: integer("weight").notNull().default(1),
    // -1 = tous les jours ; sinon 0..6 (dimanche..samedi), calé sur schedule_slots.
    dayOfWeek: smallint("day_of_week").notNull().default(-1),
    startMin: smallint("start_min").notNull().default(0),
    endMin: smallint("end_min").notNull().default(1440),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    radioIdx: index("ad_rotations_radio_idx").on(t.radioId),
    assetIdx: index("ad_rotations_asset_idx").on(t.assetId),
    dayChk: check("ad_rotations_day_chk", sql`${t.dayOfWeek} BETWEEN -1 AND 6`),
    rangeChk: check("ad_rotations_range_chk", sql`${t.startMin} < ${t.endMin} AND ${t.endMin} <= 1440`),
  }),
);

/* ═══════════════════ Facturation (abonnements Stripe) ═══════════════════
   Miroir minimal de l'abonnement Stripe d'une radio : client + subscription Stripe,
   palier et statut. Le webhook Stripe (à brancher avec la lib `stripe` + secret de
   signature) met à jour `status`/`currentPeriodEnd`. Gated par STRIPE_SECRET. */

export const subStatus = pgEnum("subscription_status", ["active", "trialing", "past_due", "canceled", "incomplete"]);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id").references(() => radios.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    planTier: text("plan_tier").notNull(), // ex. "starter", "pro"
    status: subStatus("status").notNull().default("incomplete"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    // Horodatage du dernier événement Stripe APPLIQUÉ : garde anti-désordre
    // (un événement plus ancien reçu après un plus récent est ignoré).
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    radioIdx: uniqueIndex("subscriptions_radio_idx").on(t.radioId),
    stripeCustIdx: index("subscriptions_stripe_customer_idx").on(t.stripeCustomerId),
    stripeSubIdx: uniqueIndex("subscriptions_stripe_sub_idx").on(t.stripeSubscriptionId),
  }),
);

/* ═══════════════════ Idempotence webhook Stripe ═══════════════════
   Journal des événements Stripe déjà traités : ignore les redeliveries (même
   event.id). Table technique globale (pas de radio_id → hors RLS). */
export const stripeEvents = pgTable("stripe_events", {
  eventId: text("event_id").primaryKey(),
  type: text("type").notNull(),
  eventCreatedAt: timestamp("event_created_at", { withTimezone: true }),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ═══════════════════ Dedup des rappels d'émission ═══════════════════
   Remplace le Set en mémoire process (qui dupliquait les push en multi-instance).
   Unicité (slot_id, reminder_date) : l'INSERT ON CONFLICT DO NOTHING sert de verrou
   partagé entre instances → un seul rappel part par créneau et par jour. */
export const reminderLog = pgTable(
  "reminder_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id"),
    slotId: uuid("slot_id").notNull(),
    reminderDate: text("reminder_date").notNull(), // "YYYY-MM-DD" (jour Montréal)
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slotDateIdx: uniqueIndex("reminder_log_slot_date_idx").on(t.slotId, t.reminderDate),
  }),
);

/* ───────────────────────── Relations ───────────────────────── */

export const artistsRelations = relations(artists, ({ many, one }) => ({
  user: one(users, { fields: [artists.id], references: [users.artistId] }),
  shows: many(shows),
  scheduleSlots: many(scheduleSlots),
  episodes: many(episodes),
  mixes: many(mixes),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  artist: one(artists, { fields: [users.artistId], references: [artists.id] }),
  refreshTokens: many(refreshTokens),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export const showsRelations = relations(shows, ({ one, many }) => ({
  artist: one(artists, { fields: [shows.artistId], references: [artists.id] }),
  scheduleSlots: many(scheduleSlots),
  episodes: many(episodes),
}));

export const scheduleSlotsRelations = relations(scheduleSlots, ({ one }) => ({
  show: one(shows, { fields: [scheduleSlots.showId], references: [shows.id] }),
  artist: one(artists, { fields: [scheduleSlots.artistId], references: [artists.id] }),
}));

export const episodesRelations = relations(episodes, ({ one }) => ({
  show: one(shows, { fields: [episodes.showId], references: [shows.id] }),
  artist: one(artists, { fields: [episodes.artistId], references: [artists.id] }),
}));

export const mixesRelations = relations(mixes, ({ one }) => ({
  artist: one(artists, { fields: [mixes.artistId], references: [artists.id] }),
}));

export const tracksRelations = relations(tracks, ({ one }) => ({
  radio: one(radios, { fields: [tracks.radioId], references: [radios.id] }),
}));

/* ───────────────────────── Types inférés ───────────────────────── */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Artist = typeof artists.$inferSelect;
export type Show = typeof shows.$inferSelect;
export type ScheduleSlot = typeof scheduleSlots.$inferSelect;
export type Episode = typeof episodes.$inferSelect;
export type Mix = typeof mixes.$inferSelect;
export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;
export type Role = (typeof userRole.enumValues)[number];
export type SlotTag = (typeof slotTag.enumValues)[number];
export type AnalyticsSession = typeof analyticsSessions.$inferSelect;
export type AnalyticsDaily = typeof analyticsDaily.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type AuthToken = typeof authTokens.$inferSelect;
export type Radio = typeof radios.$inferSelect;
export type NewRadio = typeof radios.$inferInsert;
export type RadioStatus = (typeof radioStatus.enumValues)[number];
export type TrackLike = typeof trackLikes.$inferSelect;
export type ReportLog = typeof reportLog.$inferSelect;
export type SongRequest = typeof songRequests.$inferSelect;
export type Listener = typeof listeners.$inferSelect;
export type NewListener = typeof listeners.$inferInsert;
export type Playlist = typeof playlists.$inferSelect;
export type PlaylistTrack = typeof playlistTracks.$inferSelect;
export type TrackPlay = typeof trackPlays.$inferSelect;
export type RequestStatus = (typeof requestStatus.enumValues)[number];
export type Poll = typeof polls.$inferSelect;
export type PollVote = typeof pollVotes.$inferSelect;
export type PollStatus = (typeof pollStatus.enumValues)[number];
export type FeaturedItem = typeof featuredItems.$inferSelect;
export type FeaturedKind = (typeof featuredKind.enumValues)[number];
