/* Types partagés côté admin (miroir des entités de l'API). */

export type Role = "owner" | "superadmin" | "animateur" | "lecteur";

/** Hiérarchie : owner > superadmin > animateur > lecteur (miroir de l'API). */
export const ROLE_RANK: Record<Role, number> = { lecteur: 1, animateur: 2, superadmin: 3, owner: 4 };

/** Le rôle est-il au moins de rang `min` ? (owner satisfait toujours superadmin). */
export function roleAtLeast(role: Role | undefined | null, min: Role): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Libellés affichés (la valeur DB reste `superadmin`/`owner`). */
export const ROLE_LABEL: Record<Role, string> = {
  owner: "Propriétaire",
  superadmin: "Admin",
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
  createdAt: string;
  live: number;
  today: number;
  sessions: number;
  listenSec: number;
  artists: number;
  shows: number;
}

/** Totaux agrégés sur tout le parc (console opérateur). */
export interface OwnerOverview {
  radios: number;
  activeRadios: number;
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

export interface AnalyticsShow {
  showTitle: string;
  totalListenSec: number;
  listeners: number;
  avgListenSec: number;
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
  live: boolean;
  last_seen: string;
}

export interface AnalyticsBreakdown {
  devices: { device: string; sessions: number }[];
  browsers: { browser: string; sessions: number }[];
  topCities: { label: string; sessions: number }[];
  newVsReturning: { returning: number; fresh: number };
  hourly: { hour: number; sessions: number }[];
}

export interface TrackHistoryEntry {
  id: string;
  artist: string;
  title: string;
  playedAt: string;
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
