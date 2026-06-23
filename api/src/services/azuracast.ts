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
    if (!r.ok) throw new Error(`AzuraCast ${path} → ${r.status} ${r.statusText}`);
    return r.status === 204 ? null : await r.json();
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
