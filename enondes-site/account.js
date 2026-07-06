/* En Ondes — Compte auditeur + bibliothèque (favoris, playlists).
 * Gère l'authentification (token access en mémoire, refresh via cookie httpOnly),
 * et l'état de la bibliothèque. Émet des événements pour que musique.js re-render.
 * API same-origin via proxy nginx /api.
 */

const META = document.querySelector('meta[name="eo-api-url"]')?.content?.trim();
const API = (META || "/api") + "/v1";

const bus = new EventTarget();
export const on = (type, fn) => bus.addEventListener(type, fn);
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

export const auth = {
  token: null,
  listener: null,
  get isAuthed() { return !!this.listener; },
};

export const favorites = new Set(); // trackIds
export let playlists = []; // [{id,name,isPublic,trackCount}]

/* ───────────────── Fetch avec Bearer + refresh auto ───────────────── */
async function raw(path, opts = {}, retry = true) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (auth.token) headers["Authorization"] = `Bearer ${auth.token}`;
  const r = await fetch(`${API}${path}`, { ...opts, headers, credentials: "include" });
  if (r.status === 401 && retry && auth.token) {
    // Token expiré → une tentative de refresh puis on rejoue.
    const ok = await refresh();
    if (ok) return raw(path, opts, false);
  }
  return r;
}

async function jsonOrThrow(r) {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.message || `Erreur ${r.status}`);
  return d;
}

/* ───────────────── Session ───────────────── */
async function refresh() {
  try {
    const r = await fetch(`${API}/account/refresh`, { method: "POST", credentials: "include" });
    if (!r.ok) return false;
    const d = await r.json();
    auth.token = d.accessToken;
    auth.listener = d.listener;
    return true;
  } catch {
    return false;
  }
}

export async function initSession() {
  const ok = await refresh();
  if (ok) {
    await loadLibrary();
    emit("authchange", { listener: auth.listener });
  }
  return ok;
}

export async function register({ email, password, displayName }) {
  const r = await raw("/account/register", { method: "POST", body: JSON.stringify({ email, password, displayName }) }, false);
  const d = await jsonOrThrow(r);
  auth.token = d.accessToken;
  auth.listener = d.listener;
  await loadLibrary();
  emit("authchange", { listener: auth.listener });
  return d.listener;
}

export async function login({ email, password }) {
  const r = await raw("/account/login", { method: "POST", body: JSON.stringify({ email, password }) }, false);
  const d = await jsonOrThrow(r);
  auth.token = d.accessToken;
  auth.listener = d.listener;
  await loadLibrary();
  emit("authchange", { listener: auth.listener });
  return d.listener;
}

export async function logout() {
  try { await fetch(`${API}/account/logout`, { method: "POST", credentials: "include" }); } catch {}
  auth.token = null;
  auth.listener = null;
  favorites.clear();
  playlists = [];
  emit("authchange", { listener: null });
  emit("favchange", {});
  emit("playlistschange", {});
}

/* ───────────────── Bibliothèque ───────────────── */
async function loadLibrary() {
  await Promise.all([loadFavorites(), loadPlaylists()]);
}

export async function loadFavorites() {
  if (!auth.isAuthed) return [];
  try {
    const rows = await jsonOrThrow(await raw("/account/favorites"));
    favorites.clear();
    for (const t of rows) favorites.add(t.id);
    emit("favchange", { tracks: rows });
    return rows;
  } catch {
    return [];
  }
}

export const isFavorite = (trackId) => favorites.has(trackId);

export async function toggleFavorite(trackId) {
  if (!auth.isAuthed) throw new Error("auth_required");
  const willAdd = !favorites.has(trackId);
  // Optimiste.
  if (willAdd) favorites.add(trackId); else favorites.delete(trackId);
  emit("favchange", {});
  try {
    await raw(`/account/favorites/${trackId}`, { method: willAdd ? "PUT" : "DELETE" });
  } catch (e) {
    // Rollback en cas d'échec.
    if (willAdd) favorites.delete(trackId); else favorites.add(trackId);
    emit("favchange", {});
    throw e;
  }
  return willAdd;
}

export async function loadPlaylists() {
  if (!auth.isAuthed) return [];
  try {
    playlists = await jsonOrThrow(await raw("/account/playlists"));
    emit("playlistschange", {});
    return playlists;
  } catch {
    return [];
  }
}

export async function createPlaylist(name) {
  const pl = await jsonOrThrow(await raw("/account/playlists", { method: "POST", body: JSON.stringify({ name }) }));
  await loadPlaylists();
  return pl;
}

export async function deletePlaylist(id) {
  await jsonOrThrow(await raw(`/account/playlists/${id}`, { method: "DELETE" }));
  await loadPlaylists();
}

export async function getPlaylist(id) {
  return jsonOrThrow(await raw(`/account/playlists/${id}`));
}

export async function addToPlaylist(id, trackId) {
  await jsonOrThrow(await raw(`/account/playlists/${id}/tracks`, { method: "POST", body: JSON.stringify({ trackId }) }));
  await loadPlaylists();
}

export async function removeFromPlaylist(id, trackId) {
  await jsonOrThrow(await raw(`/account/playlists/${id}/tracks/${trackId}`, { method: "DELETE" }));
}

/* ───────────────── Écoutes / découverte (Phase 3) ───────────────── */

/* Beacon de lecture (fire-and-forget). Attribué à l'auditeur si connecté. */
export function recordPlay(trackId) {
  const headers = {};
  if (auth.token) headers["Authorization"] = `Bearer ${auth.token}`;
  fetch(`${API}/catalog/tracks/${trackId}/play`, {
    method: "POST",
    headers,
    keepalive: true,
  }).catch(() => {});
}

/* Tendances (public) — plus écoutées sur 30 jours. */
export async function loadTrending(limit = 20) {
  try {
    const r = await fetch(`${API}/catalog/trending?limit=${limit}`, { cache: "no-store" });
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

/* Recommandations personnalisées (authentifié). */
export async function loadRecommendations() {
  if (!auth.isAuthed) return [];
  try {
    return await jsonOrThrow(await raw("/account/recommendations"));
  } catch {
    return [];
  }
}

/* Historique d'écoute de l'auditeur (authentifié). */
export async function loadHistory() {
  if (!auth.isAuthed) return [];
  try {
    return await jsonOrThrow(await raw("/account/history"));
  } catch {
    return [];
  }
}
