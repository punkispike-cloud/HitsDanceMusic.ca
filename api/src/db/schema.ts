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
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/* ───────────────────────── Enums ───────────────────────── */

export const userRole = pgEnum("user_role", ["superadmin", "animateur", "lecteur"]);

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

export const uploadKind = pgEnum("upload_kind", ["episode", "mix", "cover"]);
export const uploadStatus = pgEnum("upload_status", ["pending", "completed", "aborted"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/* ───────────────────────── artists (animateurs / DJs) ───────────────────────── */

export const artists = pgTable(
  "artists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    slugIdx: uniqueIndex("artists_slug_idx").on(t.slug),
    sortIdx: index("artists_sort_idx").on(t.sortOrder),
  }),
);

/* ───────────────────────── users ───────────────────────── */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    slugIdx: uniqueIndex("shows_slug_idx").on(t.slug),
    artistIdx: index("shows_artist_idx").on(t.artistId),
    tagIdx: index("shows_tag_idx").on(t.tag),
  }),
);

/* ───────────────────────── schedule_slots (source de SCHEDULE) ─────────────────────────
   Minutes depuis minuit (0..1440) : le front compare en minutes et gère
   "24:00" (=1440). L'API re-sérialise en "HH:MM" pour matcher SCHEDULE. */

export const scheduleSlots = pgTable(
  "schedule_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
  }),
);

/* ───────────────────────── episodes (podcasts) ───────────────────────── */

export const episodes = pgTable(
  "episodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    slugIdx: uniqueIndex("episodes_slug_idx").on(t.slug),
    artistIdx: index("episodes_artist_idx").on(t.artistId),
    showIdx: index("episodes_show_idx").on(t.showId),
    statusIdx: index("episodes_status_published_idx").on(t.status, t.publishedAt),
  }),
);

/* ───────────────────────── mixes (DJ sets) ───────────────────────── */

export const mixes = pgTable(
  "mixes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    slugIdx: uniqueIndex("mixes_slug_idx").on(t.slug),
    artistIdx: index("mixes_artist_idx").on(t.artistId),
    statusIdx: index("mixes_status_idx").on(t.status),
  }),
);

/* ───────────────────────── upload_intents (traçabilité S3 pré-signé) ───────────────────────── */

export const uploadIntents = pgTable(
  "upload_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    activeSec: integer("active_sec").notNull().default(0),
    listenSec: integer("listen_sec").notNull().default(0),
    pageViews: integer("page_views").notNull().default(0),
  },
  (t) => ({
    clientIdx: uniqueIndex("analytics_sessions_client_idx").on(t.clientId),
    lastSeenIdx: index("analytics_sessions_last_seen_idx").on(t.lastSeen),
  }),
);

/* ───────────────────────── analytics_show_listen (temps par émission) ─────────────────────────
   Agrégat par (émission, visiteur) → permet total ET moyenne par auditeur. */

export const analyticsShowListen = pgTable(
  "analytics_show_listen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    showTitle: text("show_title").notNull(),
    clientId: text("client_id").notNull(),
    listenSec: integer("listen_sec").notNull().default(0),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairIdx: uniqueIndex("analytics_show_listen_pair_idx").on(t.showTitle, t.clientId),
    showIdx: index("analytics_show_listen_show_idx").on(t.showTitle),
  }),
);

/* ───────────────────────── push_subscriptions (rappels d'émission) ─────────────────────────
   Abonnement Web Push (PushSubscription du navigateur). showSlug null = tous
   les rappels ; sinon limité à une émission. client_id = même UUID que presence/analytics. */

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    endpointIdx: uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint),
    showIdx: index("push_subscriptions_show_idx").on(t.showSlug),
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

/* ───────────────────────── Types inférés ───────────────────────── */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Artist = typeof artists.$inferSelect;
export type Show = typeof shows.$inferSelect;
export type ScheduleSlot = typeof scheduleSlots.$inferSelect;
export type Episode = typeof episodes.$inferSelect;
export type Mix = typeof mixes.$inferSelect;
export type Role = (typeof userRole.enumValues)[number];
export type SlotTag = (typeof slotTag.enumValues)[number];
export type AnalyticsSession = typeof analyticsSessions.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type AuthToken = typeof authTokens.$inferSelect;
