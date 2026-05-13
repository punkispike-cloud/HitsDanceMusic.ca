/* Now-playing : récupération métadonnées (CentovaCast / SHOUTcast / proxy /np),
   pochette iTunes, parser, historique. */

import { fetchWithTimeout, clampString, isTrustedImageUrl, NET_TIMEOUTS } from "./util.js";
import { store, STORAGE } from "./store.js";
import { state } from "./state.js";
import { SLOT_TAGS } from "./schedule.js";

export const STREAM_URL = "https://cast5.asurahosting.com/proxy/hitsdanc/stream";
export const PANEL_URL = "https://cast5.asurahosting.com/start/hitsdanc/";

// Now-playing : /np proxifié par nginx en priorité (CORS contrôlé),
// puis les endpoints publics Centova/SHOUTcast (peuvent envoyer CORS
// selon l'humeur du serveur). Plus de proxies CORS publics tiers.
const NOWPLAYING_ENDPOINTS = [
  "/np",
  "https://cast5.asurahosting.com/cc-common/nowplaying.php?m=hitsdanc",
  "https://cast5.asurahosting.com/api/nowplaying/hitsdanc",
  "https://cast5.asurahosting.com/cast/api/v2.standard/account?username=hitsdanc&xml=0&f=json",
  "https://cast5.asurahosting.com/proxy/hitsdanc/7.html",
];
const ITUNES_SEARCH = "https://itunes.apple.com/search?media=music&entity=song&limit=1&term=";

/* SVG fallback cover (initiales du host, gradient de la couleur du tag) */
export function fallbackCoverDataUri(slot) {
  const tag = SLOT_TAGS[slot.tag] || SLOT_TAGS.hitlist;
  const initials = (slot.host || "HR")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "").join("") || "HR";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${tag.color}"/><stop offset="100%" stop-color="#0a0a0a"/>
      </linearGradient>
      <radialGradient id="d" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.08)"/><stop offset="100%" stop-color="transparent"/>
      </radialGradient>
    </defs>
    <rect width="200" height="200" fill="#0a0a0a"/>
    <rect width="200" height="200" fill="url(#g)" opacity="0.85"/>
    <circle cx="100" cy="100" r="92" fill="url(#d)"/>
    <circle cx="100" cy="100" r="70" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>
    <circle cx="100" cy="100" r="52" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
    <circle cx="100" cy="100" r="14" fill="${tag.color}"/>
    <circle cx="100" cy="100" r="4" fill="#0a0a0a"/>
    <text x="100" y="180" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="14" font-weight="800" letter-spacing="2" fill="rgba(255,255,255,0.85)">${initials}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const coverCache = new Map();
export async function fetchCover(artist, title) {
  const key = `${artist}|${title}`.toLowerCase();
  if (coverCache.has(key)) return coverCache.get(key);
  try {
    const term = encodeURIComponent(`${artist} ${title}`.trim());
    const r = await fetchWithTimeout(ITUNES_SEARCH + term, { mode: "cors" }, NET_TIMEOUTS.cover);
    if (!r.ok) throw new Error("itunes http " + r.status);
    const data = await r.json();
    const hit = Array.isArray(data?.results) ? data.results[0] : null;
    const raw = typeof hit?.artworkUrl100 === "string" ? hit.artworkUrl100 : null;
    const upgraded = raw ? raw.replace(/^http:\/\//, "https://").replace("100x100", "300x300") : null;
    const url = upgraded && isTrustedImageUrl(upgraded) ? upgraded : null;
    coverCache.set(key, url);
    return url;
  } catch { coverCache.set(key, null); return null; }
}

async function tryNowPlayingEndpoint(url) {
  const r = await fetchWithTimeout(url, { mode: "cors", cache: "no-store" }, NET_TIMEOUTS.nowPlaying);
  if (!r.ok) throw new Error(`http ${r.status}`);
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const data = await r.json();
    const t = data?.data?.current_track || data?.track || data?.now_playing || data?.current || data;
    const title  = clampString(t?.title || t?.song || t?.now_playing_title || t?.track || "", 200);
    const artist = clampString(t?.artist || t?.now_playing_artist || "", 200);
    if (!title) throw new Error("empty title");
    return parseTrackString(title, artist);
  }
  const txt = clampString(await r.text(), 1000);
  if (txt && !txt.includes("<") && txt.includes(" - ")) return parseTrackString(txt);
  const csv = txt.replace(/<[^>]+>/g, "").trim();
  const cols = csv.split(",");
  if (cols.length >= 7) {
    const song = clampString(cols.slice(6).join(",").trim(), 200);
    if (song) return parseTrackString(song);
  }
  throw new Error("unparseable");
}

export async function fetchNowPlaying() {
  // Promise.any : retourne dès le premier endpoint qui répond proprement
  try {
    return await Promise.any(NOWPLAYING_ENDPOINTS.map(tryNowPlayingEndpoint));
  } catch {
    return null;
  }
}

// Parse "Stream Name - Artist - Title" ou "Artist - Title" ou juste "Title"
export function parseTrackString(s, knownArtist = "") {
  let str = (s || "").trim();
  if (!str) return null;
  str = str.replace(/^Hits?\s+Dance\s+Music\s+Stream\s*[-—|]\s*/i, "").trim();
  str = str.replace(/\s+\?\s+/g, " - ").trim();
  if (knownArtist && !str.includes(" - ")) {
    return { artist: knownArtist.trim(), title: str };
  }
  const idx = str.indexOf(" - ");
  if (idx > 0) {
    return { artist: str.slice(0, idx).trim(), title: str.slice(idx + 3).trim() };
  }
  return { artist: knownArtist.trim(), title: str };
}

export function getHistory() { return store.getJSON(STORAGE.history, []); }

export function pushHistory(track, coverUrl) {
  if (!track || !track.title) return;
  const key = `${track.artist}|${track.title}`.toLowerCase();
  if (key === state.lastTrackKey) return;
  state.lastTrackKey = key;
  const list = getHistory();
  const now = Date.now();
  list.unshift({
    artist: track.artist,
    title: track.title,
    cover: coverUrl || null,
    at: now,
    iso: new Date(now).toISOString(),
  });
  store.setJSON(STORAGE.history, list.slice(0, 12));
}
