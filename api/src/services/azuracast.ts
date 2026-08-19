/* Intégration AzuraCast (auto-hébergé, derrière la marque En Ondes).
   Crée UNE station par radio cliente via l'API REST d'AzuraCast et renvoie son
   flux + son now-playing à câbler dans le tenant. Le site En Ondes reste la
   face publique ; AzuraCast est le moteur invisible (Icecast + Liquidsoap).

   Inactif tant que AZURACAST_BASE_URL + AZURACAST_API_KEY ne sont pas fournis :
   le provisioning crée alors juste le tenant, sans station (branchement manuel
   du flux possible via streamUrl/nowPlayingUrl).

   NB : les champs exacts de l'API (POST /api/admin/stations) peuvent varier
   selon la version d'AzuraCast — à valider une fois le serveur en place. */

import { env } from "../env.js";
import { randomBytes } from "node:crypto";

export function isAzuraCastConfigured(): boolean {
  return Boolean(env.AZURACAST_BASE_URL && env.AZURACAST_API_KEY);
}

export interface StationResult {
  stationId: number;
  shortName: string;
  streamUrl: string | null;
  nowPlayingUrl: string;
}

function base(): string {
  return env.AZURACAST_BASE_URL.replace(/\/$/, "");
}

async function acFetch(path: string, init?: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetch(`${base()}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.AZURACAST_API_KEY,
        ...(init?.headers ?? {}),
      },
    });
    if (!r.ok) {
      // Inclure le corps : AzuraCast renvoie un detail JSON utile au diagnostic.
      const detail = await r.text().catch(() => "");
      throw new Error(`AzuraCast ${path} → ${r.status} ${r.statusText} ${detail.slice(0, 500)}`.trim());
    }
    return r.status === 204 ? null : await r.json();
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new Error(`AzuraCast ${path} → timeout (15s)`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/** Crée la station de diffusion d'une radio (Icecast + AutoDJ Liquidsoap). */
export async function createStation(name: string, slug: string): Promise<StationResult> {
  const station = (await acFetch("/api/admin/stations", {
    method: "POST",
    body: JSON.stringify({
      name,
      short_name: slug,
      description: `Radio ${name} — propulsée par En Ondes`,
      frontend_type: "icecast",
      backend_type: "liquidsoap",
      enable_public_page: false, // la face publique reste le site En Ondes
      enable_requests: true,
    }),
  })) as Record<string, unknown>;

  const stationId = Number(station.id);
  const shortName = String(station.short_name ?? slug);
  const mounts = station.mounts;
  const mountUrl =
    Array.isArray(mounts) && mounts[0] && typeof (mounts[0] as { url?: unknown }).url === "string"
      ? String((mounts[0] as { url: string }).url)
      : null;

  return {
    stationId,
    shortName,
    streamUrl: mountUrl,
    nowPlayingUrl: `${base()}/api/nowplaying/${shortName}`,
  };
}

/* ─────────────────────── Recordings / catch-up ────────────────────────────── */

/** Un enregistrement AzuraCast normalisé (catch-up d'un direct). */
export interface Recording {
  /** Clé source unique (nom de fichier / path AzuraCast) — pour le dédoublonnage. */
  sourceKey: string;
  title: string;
  /** URL de lecture absolue (download_link relatif → base + rel). */
  audioUrl: string;
  durationSec: number | null;
  sizeBytes: number | null;
  recordedAt: Date | null;
}

function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Coerce un timestamp AzuraCast (secondes OU ms unix, OU ISO 8601) en Date. */
function asDate(v: unknown): Date | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    // Heuristique magnitude : > 10^10 → millisecondes, sinon secondes.
    return new Date(v > 10_000_000_000 ? v : v * 1000);
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/* Liste les enregistrements (catch-up) d'une station AzuraCast identifiée par
   son short_name (= slug de la radio, cf. createStation). Réutilise le client
   `acFetch`. La forme exacte de la réponse (champs `download_link`/`path`/
   `duration`/`timestamp`…) varie selon la version d'AzuraCast — la normalisation
   est défensive. Lance une erreur HTTP (à attraper par l'appelant) si la station
   n'existe pas / n'a pas d'enregistrement. NB : l'API recordings doit être
   validée une fois le serveur AzuraCast en place (cf. note en tête de fichier). */
export async function listRecordings(stationShortName: string): Promise<Recording[]> {
  const raw = (await acFetch(
    `/api/station/${encodeURIComponent(stationShortName)}/recordings`,
  )) as unknown;
  // La réponse peut être un tableau plat ou un objet `{ recordings: [...] }`.
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { recordings?: unknown[] })?.recordings)
      ? (raw as { recordings: unknown[] }).recordings
      : [];

  const out: Recording[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const path =
      typeof r.path === "string"
        ? r.path
        : typeof r.unique_id === "string"
          ? r.unique_id
          : null;
    if (!path) continue;
    const rel = typeof r.download_link === "string" ? r.download_link : null;
    const abs =
      typeof r.url === "string" && /^https?:/i.test(r.url) ? (r.url as string) : null;
    const audioUrl = abs ?? (rel ? `${base()}${rel}` : null);
    if (!audioUrl) continue; // pas d'URL jouable → on ignore cet enregistrement
    const recordedAt = asDate(r.timestamp ?? r.record_at ?? r.start ?? r.start_timestamp);
    const fileBase = path.split("/").pop() ?? path;
    const title = recordedAt
      ? `Replay du direct (${dateStamp(recordedAt)})`
      : `Replay du direct (${fileBase})`;
    out.push({
      sourceKey: path,
      title,
      audioUrl,
      durationSec: asInt(r.duration),
      sizeBytes: asInt(r.length),
      recordedAt,
    });
  }
  return out;
}

function dateStamp(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ─────────────────────── Live DJ (harbor / streamers) ──────────────────────
   Crée un compte « streamer » (DJ) sur la station AzuraCast : username + mot de
   passe que le DJ utilise pour se connecter au harbor (BUTT/Mixxx, ou Webcaster.js
   côté navigateur). Gated par isAzuraCastConfigured — sans serveur AzuraCast, rien.

   NB : la forme exacte de l'API (POST /api/station/{short}/streamers) et l'URL du
   harbor varient selon la version d'AzuraCast — À VALIDER une fois le serveur en
   place. Le front (Webcaster.js + input.harbor.ssl) est le point fragile (cf.
   DIFFUSION-FAISABILITE.md, ~4-8 sem). Scaffold défensif : ne casse rien tant
   qu'AzuraCast n'est pas configuré. */
export interface HarborCredentials {
  streamerId: number;
  username: string;
  password: string;
  stationShortName: string;
  harborUrl: string; // à confirmer selon la config AzuraCast (mount du harbor)
}

function djUsername(djName: string): string {
  const u = djName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return u || `dj_${Date.now()}`;
}

/* ─────────────── Synchro pubs/jingles → playlists AzuraCast ───────────────
   Pousse le plan de rotation local (media_assets + ad_rotations, cf. page admin
   /medias) vers AzuraCast : une playlist par rotation active (poids + fenêtre
   horaire), l'audio du média téléversé dans les fichiers de la station puis
   rattaché à la playlist. Best-effort par rotation : une erreur n'interrompt
   pas les autres. Gated par isAzuraCastConfigured (503 côté route sinon).

   NB : formes d'API à VALIDER une fois le serveur en place (même réserve que
   createStation/createStreamer) : GET/POST /api/station/{short}/files,
   GET/POST/PUT /api/station/{short}/playlist(s), PUT /api/station/{short}/file/{id}. */

/** Minutes depuis minuit → entier HHMM AzuraCast (ex. 390 → 630 = 06:30).
 *  1440 (fin de journée) → 0 (minuit, convention AzuraCast). */
export function toAzuraTime(min: number): number {
  if (min >= 1440) return 0;
  return Math.floor(min / 60) * 100 + (min % 60);
}

/** Jour local (0=dimanche..6=samedi, -1=tous) → jours ISO AzuraCast (1=lundi..7=dimanche).
 *  -1 → null (pas de restriction de jour). */
export function toAzuraDays(dayOfWeek: number): number[] | null {
  if (dayOfWeek < 0) return null;
  return [dayOfWeek === 0 ? 7 : dayOfWeek];
}

export interface RotationForSync {
  id: string;
  weight: number;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  asset: { id: string; name: string; audioUrl: string };
}

export interface RotationSyncResult {
  rotationId: string;
  assetName: string;
  ok: boolean;
  error?: string;
}

const playlistName = (rotationId: string) => `eo-rot-${rotationId.slice(0, 8)}`;
const mediaPath = (assetId: string, audioUrl: string) => {
  const ext = /\.(mp3|m4a|aac|ogg|wav)(\?|$)/i.exec(audioUrl)?.[1]?.toLowerCase() ?? "mp3";
  return `enondes-media/${assetId}.${ext}`;
};

/** Synchronise les rotations actives d'une radio vers sa station AzuraCast. */
export async function syncRotationsToStation(
  stationShortName: string,
  rotations: RotationForSync[],
): Promise<RotationSyncResult[]> {
  const short = encodeURIComponent(stationShortName);

  // Inventaires existants (une requête chacun, pas par rotation).
  const filesRaw = (await acFetch(`/api/station/${short}/files`)) as unknown;
  const fileIdByPath = new Map<string, number>();
  if (Array.isArray(filesRaw)) {
    for (const f of filesRaw) {
      const r = f as Record<string, unknown>;
      if (typeof r.path === "string" && r.id != null) fileIdByPath.set(r.path, Number(r.id));
    }
  }
  const playlistsRaw = (await acFetch(`/api/station/${short}/playlists`)) as unknown;
  const playlistIdByName = new Map<string, number>();
  if (Array.isArray(playlistsRaw)) {
    for (const p of playlistsRaw) {
      const r = p as Record<string, unknown>;
      if (typeof r.name === "string" && r.id != null) playlistIdByName.set(r.name, Number(r.id));
    }
  }

  const results: RotationSyncResult[] = [];
  for (const rot of rotations) {
    try {
      // 1. Audio du média présent dans la station (téléversement base64 sinon).
      const path = mediaPath(rot.asset.id, rot.asset.audioUrl);
      let mediaId = fileIdByPath.get(path);
      if (mediaId == null) {
        const audio = await fetch(rot.asset.audioUrl);
        if (!audio.ok) throw new Error(`audio ${rot.asset.audioUrl} → ${audio.status}`);
        const b64 = Buffer.from(await audio.arrayBuffer()).toString("base64");
        const up = (await acFetch(`/api/station/${short}/files`, {
          method: "POST",
          body: JSON.stringify({ path, file: b64 }),
        })) as Record<string, unknown>;
        mediaId = Number(up.id);
        fileIdByPath.set(path, mediaId);
      }

      // 2. Playlist de la rotation (créée ou mise à jour : poids + fenêtre).
      const days = toAzuraDays(rot.dayOfWeek);
      const body = JSON.stringify({
        name: playlistName(rot.id),
        type: "default",
        is_enabled: true,
        weight: rot.weight,
        schedule_items: [
          {
            start_time: toAzuraTime(rot.startMin),
            end_time: toAzuraTime(rot.endMin),
            ...(days ? { days } : {}),
          },
        ],
      });
      let playlistId = playlistIdByName.get(playlistName(rot.id));
      if (playlistId == null) {
        const created = (await acFetch(`/api/station/${short}/playlists`, {
          method: "POST",
          body,
        })) as Record<string, unknown>;
        playlistId = Number(created.id);
        playlistIdByName.set(playlistName(rot.id), playlistId);
      } else {
        await acFetch(`/api/station/${short}/playlist/${playlistId}`, { method: "PUT", body });
      }

      // 3. Rattache le média à la playlist.
      await acFetch(`/api/station/${short}/file/${mediaId}`, {
        method: "PUT",
        body: JSON.stringify({ playlists: [{ id: playlistId }] }),
      });

      results.push({ rotationId: rot.id, assetName: rot.asset.name, ok: true });
    } catch (err) {
      results.push({
        rotationId: rot.id,
        assetName: rot.asset.name,
        ok: false,
        error: (err as Error).message,
      });
    }
  }
  return results;
}

export async function createStreamer(stationShortName: string, djName: string): Promise<HarborCredentials> {
  const password = randomBytes(12).toString("base64url");
  const r = (await acFetch(`/api/station/${encodeURIComponent(stationShortName)}/streamers`, {
    method: "POST",
    body: JSON.stringify({
      streamer_username: djUsername(djName),
      streamer_password: password,
      display_name: djName,
      is_active: true,
    }),
  })) as Record<string, unknown>;
  return {
    streamerId: Number(r.id),
    username: String(r.streamer_username ?? djUsername(djName)),
    password,
    stationShortName,
    harborUrl: `${base()}/listen/${encodeURIComponent(stationShortName)}/streamer`,
  };
}
