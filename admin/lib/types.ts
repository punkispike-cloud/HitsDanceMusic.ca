/* Types partagés côté admin (miroir des entités de l'API). */

export type Role = "owner" | "superadmin" | "animateur" | "lecteur" | "it";

/** Hiérarchie linéaire (anti-escalade/gestion uniquement — miroir de l'API) :
    owner > it > superadmin > animateur > lecteur. NB : ce rang ne dit rien des
    CAPACITÉS (éditorial vs cross-radio) — cf. isEditorialAdmin/isCrossRadio. */
export const ROLE_RANK: Record<Role, number> = { lecteur: 1, animateur: 2, superadmin: 3, it: 4, owner: 5 };

/** Le rôle est-il au moins de rang `min` ? (rang linéaire, anti-escalade). */
export function roleAtLeast(role: Role | undefined | null, min: Role): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Axe ÉDITORIAL : gère le contenu d'une radio = superadmin + owner. EXCLUT `it`. */
export function isEditorialAdmin(role: Role | undefined | null): boolean {
  return role === "superadmin" || role === "owner";
}

/** Axe CROSS-RADIO (parc / technique) = owner + it. EXCLUT superadmin. */
export function isCrossRadio(role: Role | undefined | null): boolean {
  return role === "owner" || role === "it";
}

/** Axe ANTENNE : animateur + admins éditoriaux (superadmin + owner). EXCLUT
    `it` (technique) et `lecteur` — miroir des requireRole API sur les
    demandes/sondages (données d'auditeurs, audit 2026-08-16 G5). */
export function isOnAir(role: Role | undefined | null): boolean {
  return role === "animateur" || role === "superadmin" || role === "owner";
}

/** Libellés affichés (la valeur DB reste `superadmin`/`owner`/`it`). */
export const ROLE_LABEL: Record<Role, string> = {
  owner: "En Ondes",
  it: "IT",
  superadmin: "Gestionnaire",
  animateur: "Animateur",
  lecteur: "Lecteur",
};
export type SlotTag =
  | "morning"
  | "hitlist"
  | "drive"
  | "limelight"
  | "night"
  | "special"
  | "audition";
export type ContentStatus = "draft" | "published" | "archived";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  artistId: string | null;
}

export type RadioStatus = "active" | "provisioning" | "paused";

/** Une radio (tenant) + ses KPIs, vue depuis la console opérateur (owner). */
export interface RadioSummary {
  id: string;
  slug: string;
  name: string;
  status: RadioStatus;
  plan: string | null;
  domains: string[];
  streamUrl: string | null;
  nowPlayingUrl: string | null;
  billingNote: string | null;
  monthlyPrice: number | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  licenseConfirmed: boolean;
  healthStatus?: "up" | "down" | "silent" | "unknown" | null;
  lastCheckedAt?: string | null;
  createdAt: string;
  live: number;
  today: number;
  sessions: number;
  listenSec: number;
  artists: number;
  shows: number;
}

/** Point de série quotidienne (console opérateur : courbes de tendance). */
export interface OwnerTimeseriesPoint {
  day: string;
  sessions: number;
  listen_sec: number;
}

/** Santé du flux d'une radio (ping now-playing/stream, console opérateur). */
export interface RadioHealth {
  id: string;
  status: "up" | "down" | "none";
  ms: number | null;
}

/** Métadonnées copiables pour inscrire la radio sur les plateformes externes. */
export interface DistributionMetadata {
  name: string;
  slug: string;
  streamUrl: string | null;
  nowPlayingUrl: string | null;
  domains: string[];
}

/** Une ligne de la checklist d'inscription (TuneIn, Radio Garden, Alexa…). */
export interface DistributionChannel {
  key: string;
  label: string;
  done: boolean;
}

/** Colis d'inscription renvoyé par GET /v1/owner/radios/:id/distribution. */
export interface DistributionPackage {
  package: DistributionMetadata;
  checklist: DistributionChannel[];
  /** Id de station TuneIn (ex. s123456). Renseigné → le now-playing de cette
   *  radio part vers l'API AIR à chaque changement de titre. Vide = débranché. */
  tuneinStationId: string;
  /** Vrai quand l'id de station ET les identifiants partenaire (côté serveur)
   *  sont réunis : l'envoi est réellement actif. */
  tuneinPushReady: boolean;
}

/** Abonnement (miroir Stripe) renvoyé par GET /v1/owner/radios/:id/billing. */
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete";

export interface Subscription {
  id: string;
  radioId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  planTier: string;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
}

/** Totaux agrégés sur tout le parc (console opérateur). */
export interface OwnerOverview {
  radios: number;
  activeRadios: number;
  mrr: number;
  sessions: number;
  live: number;
  today: number;
  listenSec: number;
}

export interface Artist {
  id: string;
  slug: string;
  name: string;
  photoUrl: string | null;
  initials: string | null;
  showTitle: string | null;
  scheduleText: string | null;
  bio: string | null;
  socials: Record<string, string>;
  sortOrder: number;
  isPublished: boolean;
}

export interface Show {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  tag: SlotTag | null;
  badge: string | null;
  artistId: string | null;
  scheduleText: string | null;
  sortOrder: number;
  isPublished: boolean;
}

export type FeaturedKind = "homepage" | "rail";

export interface FeaturedItem {
  id: string;
  kind: FeaturedKind;
  tag: string | null;
  title: string;
  meta: string | null;
  body: string | null;
  coverUrl: string | null;
  emoji: string | null;
  linkUrl: string | null;
  variant: string | null;
  sortOrder: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleSlot {
  id: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  title: string;
  hostLabel: string;
  tag: SlotTag;
  showId: string | null;
  artistId: string | null;
  isLive: boolean;
}

export interface Episode {
  id: string;
  slug: string;
  showId: string | null;
  artistId: string;
  title: string;
  description: string | null;
  audioUrl: string | null;
  durationSec: number | null;
  coverUrl: string | null;
  season: number | null;
  episodeNumber: number | null;
  status: ContentStatus;
  publishedAt: string | null;
}

export interface Mix {
  id: string;
  slug: string;
  artistId: string;
  title: string;
  description: string | null;
  genre: string | null;
  audioUrl: string | null;
  durationSec: number | null;
  coverUrl: string | null;
  status: ContentStatus;
  publishedAt: string | null;
}

/** Piste de la bibliothèque (source material du studio de mix). Miroir de la
 *  table `tracks` (api/src/db/schema.ts). `artist` est texte libre (pas une FK). */
export interface Track {
  id: string;
  artist: string;
  title: string;
  genre: string | null;
  bpm: number | null;
  durationSec: number | null;
  audioUrl: string | null;
  audioKey: string | null;
  sizeBytes: number | null;
  source: string | null;
  license: string | null;
  status: ContentStatus;
  createdAt: string;
  updatedAt: string;
}

export type MediaAssetKind = "jingle" | "ad" | "intro" | "outro" | "bed";

export interface MediaAsset {
  id: string;
  kind: MediaAssetKind;
  name: string;
  audioUrl: string | null;
  durationSec: number | null;
  status: ContentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AdRotation {
  id: string;
  assetId: string | null;
  weight: number;
  dayOfWeek: number; // -1 = tous les jours ; sinon 0..6 (dimanche..samedi)
  startMin: number;
  endMin: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  artistId: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface AnalyticsOverview {
  totalSessions: number;
  live: number;
  today: number;
  pageViews: number;
  totalActiveSec: number;
  totalListenSec: number;
  avgActiveSec: number;
  avgListenSec: number;
}

/** Chiffres clés FENÊTRÉS (période choisie), depuis analytics_daily — chaque
 *  beacon crédite le jour où il arrive, donc la fenêtre est exacte. */
export interface AnalyticsSummary {
  days: number;
  visitors: number;
  listenSec: number;
  activeSec: number;
  pageViews: number;
  avgListenSec: number;
  avgActiveSec: number;
}

export interface AnalyticsShow {
  showTitle: string;
  totalListenSec: number;
  listeners: number;
  avgListenSec: number;
}

/** Titre le plus diffusé (feedback de programmation). listenSec/listeners =
 *  écoute RÉELLE par titre (attribuée à l'ingestion) — null tant que la
 *  collecte (démarrée avec la migration 0031) n'a rien pour ce titre. */
export interface TopTrack {
  trackId: string;
  artist: string;
  title: string;
  playCount: number;
  likeCount: number;
  listenSec: number | null;
  listeners: number | null;
}

export interface AnalyticsSession {
  id: string;
  clientId: string;
  ip: string | null;
  ipCountry: string | null;
  userAgent: string | null;
  device: string | null;
  browser: string | null;
  firstSeen: string;
  lastSeen: string;
  activeSec: number;
  listenSec: number;
  pageViews: number;
}

export interface AnalyticsPoint {
  day: string;
  sessions: number;
  listen_sec: number;
  active_sec: number;
  page_views: number;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  label: string | null;
  sessions: number;
  /** Sessions en direct (last_seen < 60 s) dans ce bucket — compte EXACT côté
   *  serveur, cohérent avec `AnalyticsOverview.live`. La légende de la carte
   *  somme ce champ (et non `sessions`, qui totalise l'historique du bucket). */
  live_sessions: number;
  live: boolean;
  last_seen: string;
}

/** Répartitions FENÊTRÉES : visiteurs actifs sur la période. « De retour » =
 *  vu sur ≥ 2 jours distincts de la période. `hourly` = écoute réelle par heure
 *  locale (collecte démarrée avec la migration 0031 — vide avant). */
export interface AnalyticsBreakdown {
  days: number;
  devices: { device: string; sessions: number }[];
  browsers: { browser: string; sessions: number }[];
  topCities: { label: string; sessions: number }[];
  newVsReturning: { returning: number; fresh: number };
  hourly: { hour: number; listen_sec: number; active_sec: number }[];
}

export interface TrackHistoryEntry {
  id: string;
  artist: string;
  title: string;
  playedAt: string;
}

export type RequestStatus = "new" | "read" | "queued" | "played" | "ignored";

/** Demande de titre / dédicace déposée par un auditeur (file animateur). */
export interface SongRequest {
  id: string;
  clientId: string;
  artist: string;
  title: string;
  dedication: string | null;
  requesterName: string | null;
  showId: string | null;
  slotId: string | null;
  status: RequestStatus;
  handledAt: string | null;
  handledBy: string | null;
  createdAt: string;
}

export type PollStatus = "active" | "closed";

/** Sondage en direct posé par l'animateur (vote anonyme par client_id côté site). */
export interface Poll {
  id: string;
  showId: string | null;
  slotId: string | null;
  question: string;
  options: string[];
  status: PollStatus;
  createdBy: string | null;
  closedAt: string | null;
  createdAt: string;
}

/** Résultat d'une option (tally en direct). */
export interface PollResult {
  optionIndex: number;
  label: string;
  count: number;
}

/** Dépouillement d'un sondage (GET /v1/admin/polls/:id/results). */
export interface PollResults {
  results: PollResult[];
  totalVotes: number;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
}

export interface AuditResponse {
  rows: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface PushStats {
  enabled: boolean;
  total: number;
  global: number;
}

export function formatDuration(sec: number): string {
  if (!sec || sec < 60) return `${Math.max(0, Math.floor(sec))} s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

export const SLOT_TAGS: { value: SlotTag; label: string; color: string }[] = [
  { value: "morning", label: "Morning", color: "var(--tag-morning)" },
  { value: "hitlist", label: "Hit List", color: "var(--tag-hitlist)" },
  { value: "drive", label: "Drive", color: "var(--tag-drive)" },
  { value: "limelight", label: "Limelight", color: "var(--tag-limelight)" },
  { value: "night", label: "Nuits", color: "var(--tag-night)" },
  { value: "special", label: "Spécial", color: "var(--tag-special)" },
  { value: "audition", label: "Audition", color: "var(--tag-audition)" },
];

export const DAY_NAMES = [
  "Dimanche",
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
];

export function tagColor(tag: SlotTag | null): string {
  return SLOT_TAGS.find((t) => t.value === tag)?.color ?? "var(--tag-audition)";
}

export function minToHHMM(total: number): string {
  if (total === 1440) return "24:00";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function hhmmToMin(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}
