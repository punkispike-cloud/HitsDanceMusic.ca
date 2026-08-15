/* En Ondes — Catalogue musical à la demande.
 * Lit l'API publique /v1/catalog/* (proxifiée same-origin via nginx sous /api),
 * affiche la liste des pistes, et les joue à la demande dans UN <audio> avec
 * une file de lecture (précédent/suivant/aléatoire/répéter). Séparé du lecteur
 * « en direct » du hub : ici tout est on-demand (fichiers S3/R2, media-src https:).
 */

const $ = (s, r = document) => r.querySelector(s);
const byId = (id) => document.getElementById(id);

import * as acct from "./account.js";

// Base API : same-origin via le proxy nginx /api ; surchargeable pour le dev.
const META = document.querySelector('meta[name="eo-api-url"]')?.content?.trim();
const API = (META || "/api") + "/v1";

const LS = { volume: "eo.cat.volume", shuffle: "eo.cat.shuffle", repeat: "eo.cat.repeat" };

const state = {
  tracks: [], // liste affichée (= file de lecture)
  index: -1, // index de la piste courante dans state.tracks
  playing: false,
  shuffle: false,
  repeat: false,
  q: "",
  genre: null,
  sort: "recent",
  order: [], // ordre de lecture (indices) — mélangé si shuffle
  orderPos: -1,
  searchTimer: null,
  view: "catalog", // catalog | favorites | playlists
  openPlaylistId: null, // détail de playlist ouvert
  pickTrackId: null, // piste en cours d'ajout à une playlist
};

const audio = new Audio();
audio.preload = "metadata";

/* ───────────────── Utilitaires ───────────────── */
const norm = (s) => (s || "").toLowerCase();
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const initials = (name) =>
  (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "♪";

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function announce(msg) {
  const el = byId("catLive");
  if (el) el.textContent = msg;
}

async function fetchJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/* ───────────────── Pochettes (iTunes, best-effort) ───────────────── */
const coverCache = new Map();
async function fetchCover(artist, title) {
  const key = `${artist}|${title}`.toLowerCase();
  if (coverCache.has(key)) return coverCache.get(key);
  try {
    const term = encodeURIComponent(`${artist} ${title}`.trim());
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=1&term=${term}`, { signal: ctl.signal });
    clearTimeout(to);
    const d = await r.json();
    const raw = d?.results?.[0]?.artworkUrl100;
    const url = typeof raw === "string" ? raw.replace(/^http:/, "https:").replace("100x100", "300x300") : null;
    coverCache.set(key, url);
    return url;
  } catch {
    coverCache.set(key, null);
    return null;
  }
}

/* ───────────────── Chargement du catalogue ───────────────── */
async function loadGenres() {
  try {
    const rows = await fetchJson(`${API}/catalog/genres`);
    const box = byId("genres");
    box.innerHTML = "";
    const chip = (label, active, on) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `chip ${active ? "on" : ""}`;
      b.textContent = label;
      b.addEventListener("click", on);
      return b;
    };
    box.appendChild(chip("Tous", !state.genre, () => {
      state.genre = null;
      loadGenres();
      loadTracks();
    }));
    for (const g of rows) {
      if (!g.genre) continue;
      box.appendChild(chip(`${g.genre} (${g.count})`, state.genre === g.genre, () => {
        state.genre = state.genre === g.genre ? null : g.genre;
        loadGenres();
        loadTracks();
      }));
    }
  } catch {
    /* pas de genres → chips masqués, non bloquant */
  }
}

async function loadTracks() {
  const list = byId("cat");
  list.setAttribute("aria-busy", "true");
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.genre) params.set("genre", state.genre);
  if (state.sort) params.set("sort", state.sort);
  params.set("limit", "100");
  try {
    const rows = await fetchJson(`${API}/catalog/tracks?${params.toString()}`);
    state.tracks = Array.isArray(rows) ? rows : [];
    renderList();
  } catch (e) {
    state.tracks = [];
    list.innerHTML = `<div class="cat-empty"><p>Impossible de charger le catalogue.</p><p class="fine">${esc(e.message || "")}</p></div>`;
    byId("count").textContent = "";
  } finally {
    list.setAttribute("aria-busy", "false");
  }
}

/* ───────────────── Rendu de la liste ───────────────── */
function renderList() {
  const list = byId("cat");
  const n = state.tracks.length;
  byId("count").textContent = n ? `${n} piste${n > 1 ? "s" : ""}` : "";

  if (!n) {
    list.innerHTML = emptyStateHtml();
    byId("catReset")?.addEventListener("click", () => {
      state.q = ""; state.genre = null;
      byId("q").value = "";
      loadGenres(); loadTracks();
    });
    byId("emptyLogin")?.addEventListener("click", openAuthModal);
    return;
  }

  const frag = document.createDocumentFragment();
  state.tracks.forEach((t, i) => {
    const row = document.createElement("article");
    row.className = "track-row";
    row.dataset.index = String(i);
    const fav = acct.isFavorite(t.id);
    const inPlaylist = state.view === "playlist";
    row.innerHTML = `
      <button class="tr-play" type="button" aria-label="Lire ${esc(t.title)} par ${esc(t.artist)}">
        <span class="tr-cover" data-cover><span class="mono">${esc(initials(t.artist))}</span></span>
        <span class="tr-playico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
      </button>
      <div class="tr-meta">
        <span class="tr-title">${esc(t.title)}</span>
        <span class="tr-artist">${esc(t.artist)}${t.radioName ? ` · <span class="tr-radio">${esc(t.radioName)}</span>` : ""}</span>
      </div>
      <span class="tr-genre">${esc(t.genre || "")}</span>
      <span class="tr-dur">${t.durationSec ? fmtTime(t.durationSec) : ""}</span>
      <div class="tr-actions">
        <button class="tr-fav ${fav ? "on" : ""}" type="button" aria-label="${fav ? "Retirer des favoris" : "Ajouter aux favoris"}" aria-pressed="${fav}">
          <svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2 5 5.2 5c1.9 0 3.3 1 3.8 2 .5-1 1.9-2 3.8-2C16 5 17.6 8.4 16 11.7 15.5 12.6 14 14.5 12 21z" transform="translate(0 -1)"/></svg>
        </button>
        <button class="tr-add" type="button" aria-label="Ajouter à une playlist">
          <svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>
        </button>
        ${inPlaylist ? `<button class="tr-remove" type="button" aria-label="Retirer de la playlist"><svg viewBox="0 0 24 24"><path d="M5 11h14v2H5z"/></svg></button>` : ""}
      </div>`;
    row.querySelector(".tr-play").addEventListener("click", () => playAt(i));
    row.querySelector(".tr-fav").addEventListener("click", () => onToggleFav(t.id));
    row.querySelector(".tr-add").addEventListener("click", () => openPlaylistPicker(t.id));
    row.querySelector(".tr-remove")?.addEventListener("click", () => onRemoveFromPlaylist(t.id));
    frag.appendChild(row);
  });
  list.innerHTML = "";
  list.appendChild(frag);

  // Pochettes en arrière-plan (best-effort, non bloquant).
  state.tracks.forEach((t, i) => {
    fetchCover(t.artist, t.title).then((url) => {
      if (!url) return;
      const el = list.querySelector(`.track-row[data-index="${i}"] [data-cover]`);
      if (el) el.style.backgroundImage = `url("${url}")`, el.classList.add("has-img");
    });
  });
  highlightCurrent();
}

function emptyStateHtml() {
  if (state.view === "discover") {
    return `<div class="cat-empty"><div class="cat-empty-ico" aria-hidden="true">✨</div><p>Rien à découvrir pour l'instant.</p><p class="fine">Écoute quelques pistes — les tendances et recommandations s'affineront.</p></div>`;
  }
  if (state.view === "history") {
    return acct.auth.isAuthed
      ? `<div class="cat-empty"><div class="cat-empty-ico" aria-hidden="true">↻</div><p>Aucune écoute récente.</p></div>`
      : `<div class="cat-empty"><div class="cat-empty-ico" aria-hidden="true">↻</div><p>Connecte-toi pour voir ton historique.</p><button class="ghost-btn" id="emptyLogin" type="button">Connexion</button></div>`;
  }
  if (state.view === "favorites") {
    return acct.auth.isAuthed
      ? `<div class="cat-empty"><div class="cat-empty-ico" aria-hidden="true">♥</div><p>Aucun favori pour l'instant.</p><p class="fine">Touche le cœur sur une piste pour la retrouver ici.</p></div>`
      : `<div class="cat-empty"><div class="cat-empty-ico" aria-hidden="true">♥</div><p>Connecte-toi pour garder tes favoris.</p><button class="ghost-btn" id="emptyLogin" type="button">Connexion</button></div>`;
  }
  if (state.view === "playlist") {
    return `<div class="cat-empty"><div class="cat-empty-ico" aria-hidden="true">♪</div><p>Cette playlist est vide.</p><p class="fine">Ajoute des pistes via le bouton + du catalogue.</p></div>`;
  }
  return `<div class="cat-empty">
      <div class="cat-empty-ico" aria-hidden="true">♪</div>
      <p>Aucune piste ${state.q || state.genre ? "pour cette recherche" : "dans le catalogue pour l'instant"}.</p>
      ${state.q || state.genre ? `<button class="ghost-btn" id="catReset" type="button">Réinitialiser</button>` : `<p class="fine">Ajoute des pistes via la console d'admin (Pistes → téléverser).</p>`}
    </div>`;
}

/* ───────────────── File de lecture ───────────────── */
function buildOrder(startIndex) {
  const idx = state.tracks.map((_, i) => i);
  if (state.shuffle) {
    // Fisher-Yates, en gardant startIndex en tête.
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const p = idx.indexOf(startIndex);
    if (p > 0) [idx[0], idx[p]] = [idx[p], idx[0]];
  }
  state.order = idx;
  state.orderPos = state.shuffle ? 0 : startIndex;
}

function playAt(i) {
  if (i < 0 || i >= state.tracks.length) return;
  buildOrder(i);
  loadCurrent(i);
}

function loadCurrent(i) {
  const t = state.tracks[i];
  if (!t || !t.audioUrl) {
    announce("Cette piste n'a pas de fichier audio.");
    return;
  }
  state.index = i;
  audio.src = t.audioUrl;
  audio.play().catch(() => {});
  byId("player").hidden = false;
  byId("pTrack").textContent = t.title;
  byId("pArtist").textContent = t.artist + (t.radioName ? ` · ${t.radioName}` : "");
  const cover = byId("pCover");
  cover.innerHTML = `<span class="mono">${esc(initials(t.artist))}</span>`;
  cover.style.backgroundImage = "";
  cover.classList.remove("has-img");
  fetchCover(t.artist, t.title).then((url) => {
    if (url && state.index === i) {
      cover.style.backgroundImage = `url("${url}")`;
      cover.classList.add("has-img");
    }
  });
  // MediaSession (contrôles OS / écran verrouillé).
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist, album: t.radioName || "En Ondes",
    });
  }
  document.title = `${t.title} — ${t.artist} · En Ondes`;
  highlightCurrent();
  announce(`Lecture : ${t.title} par ${t.artist}`);
  acct.recordPlay(t.id); // beacon (tendances / historique / reco)
}

function nextTrack(auto = false) {
  if (!state.tracks.length) return;
  if (state.repeat && auto) { loadCurrent(state.index); return; }
  if (!state.order.length) buildOrder(state.index < 0 ? 0 : state.index);
  let pos = state.orderPos + 1;
  if (pos >= state.order.length) {
    if (auto && !state.repeat) { setPlayingUI(false); return; } // fin de file
    pos = 0; // boucle en navigation manuelle
  }
  state.orderPos = pos;
  loadCurrent(state.order[pos]);
}

function prevTrack() {
  if (!state.tracks.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (!state.order.length) buildOrder(state.index < 0 ? 0 : state.index);
  let pos = state.orderPos - 1;
  if (pos < 0) pos = state.order.length - 1;
  state.orderPos = pos;
  loadCurrent(state.order[pos]);
}

function highlightCurrent() {
  const list = byId("cat");
  list.querySelectorAll(".track-row.playing").forEach((el) => el.classList.remove("playing"));
  if (state.index >= 0) {
    list.querySelector(`.track-row[data-index="${state.index}"]`)?.classList.add("playing");
  }
}

/* ───────────────── UI lecteur ───────────────── */
function setPlayingUI(playing) {
  state.playing = playing;
  const btn = byId("pPlay");
  btn.classList.toggle("is-playing", playing);
  btn.setAttribute("aria-label", playing ? "Pause" : "Lecture");
  btn.innerHTML = playing
    ? `<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`
    : `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
}

function togglePlay() {
  if (state.index < 0) { if (state.tracks.length) playAt(0); return; }
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}

/* ───────────────── Événements audio ───────────────── */
audio.addEventListener("play", () => setPlayingUI(true));
audio.addEventListener("playing", () => setPlayingUI(true));
audio.addEventListener("pause", () => setPlayingUI(false));
audio.addEventListener("ended", () => nextTrack(true));
audio.addEventListener("timeupdate", () => {
  const seek = byId("seek");
  if (audio.duration) {
    seek.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
    byId("pCur").textContent = fmtTime(audio.currentTime);
    byId("pDur").textContent = fmtTime(audio.duration);
  }
});
audio.addEventListener("loadedmetadata", () => {
  byId("pDur").textContent = fmtTime(audio.duration);
});

/* ───────────────── Contrôles UI ───────────────── */
function wireControls() {
  byId("pPlay").addEventListener("click", togglePlay);
  byId("pNext").addEventListener("click", () => nextTrack(false));
  byId("pPrev").addEventListener("click", prevTrack);

  const shuffleBtn = byId("pShuffle");
  shuffleBtn.addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    shuffleBtn.classList.toggle("on", state.shuffle);
    shuffleBtn.setAttribute("aria-pressed", String(state.shuffle));
    try { localStorage.setItem(LS.shuffle, state.shuffle ? "1" : "0"); } catch {}
    if (state.index >= 0) buildOrder(state.index);
  });

  const repeatBtn = byId("pRepeat");
  repeatBtn.addEventListener("click", () => {
    state.repeat = !state.repeat;
    repeatBtn.classList.toggle("on", state.repeat);
    repeatBtn.setAttribute("aria-pressed", String(state.repeat));
    try { localStorage.setItem(LS.repeat, state.repeat ? "1" : "0"); } catch {}
  });

  const seek = byId("seek");
  seek.addEventListener("input", () => {
    if (audio.duration) audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
  });

  const vol = byId("vol");
  vol.addEventListener("input", () => {
    audio.volume = Number(vol.value);
    try { localStorage.setItem(LS.volume, vol.value); } catch {}
  });

  byId("q").addEventListener("input", (e) => {
    state.q = e.target.value.trim();
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(loadTracks, 280);
  });

  byId("sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    loadTracks();
  });

  // Raccourci clavier : Espace = play/pause (hors champ de saisie).
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
      e.preventDefault();
      togglePlay();
    }
  });

  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => audio.play().catch(() => {}));
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => nextTrack(false));
    navigator.mediaSession.setActionHandler("previoustrack", () => prevTrack());
  }

  window.addEventListener("online", () => { byId("netbar").hidden = true; });
  window.addEventListener("offline", () => { byId("netbar").hidden = false; });
}

/* ───────────────── Favoris / vues / playlists / compte ───────────────── */
function refreshHearts() {
  document.querySelectorAll(".track-row").forEach((row) => {
    const i = Number(row.dataset.index);
    const t = state.tracks[i];
    if (!t) return;
    const btn = row.querySelector(".tr-fav");
    if (!btn) return;
    const fav = acct.isFavorite(t.id);
    btn.classList.toggle("on", fav);
    btn.setAttribute("aria-pressed", String(fav));
    btn.setAttribute("aria-label", fav ? "Retirer des favoris" : "Ajouter aux favoris");
  });
}

async function onToggleFav(trackId) {
  if (!acct.auth.isAuthed) { openAuthModal(); return; }
  try {
    await acct.toggleFavorite(trackId);
    if (state.view === "favorites") loadFavoritesView();
    else refreshHearts();
  } catch { announce("Action impossible."); }
}

function showControls(show) {
  const c = document.querySelector(".controls");
  const g = byId("genres");
  if (c) c.style.display = show ? "" : "none";
  if (g) g.style.display = show ? "" : "none";
}

function setActiveTab(view) {
  document.querySelectorAll("#tabs .tab").forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
  });
}

function switchView(view) {
  state.view = view;
  state.openPlaylistId = null;
  setActiveTab(view);
  showControls(view === "catalog");
  if (view === "catalog") { byId("viewTitle").innerHTML = `<span class="hex" aria-hidden="true"></span>Pistes`; loadTracks(); }
  else if (view === "discover") { byId("viewTitle").innerHTML = `<span class="hex" aria-hidden="true"></span>${acct.auth.isAuthed ? "Pour toi" : "Tendances"}`; loadDiscoverView(); }
  else if (view === "favorites") { byId("viewTitle").innerHTML = `<span class="hex" aria-hidden="true"></span>Favoris`; loadFavoritesView(); }
  else if (view === "playlists") { byId("viewTitle").innerHTML = `<span class="hex" aria-hidden="true"></span>Playlists`; renderPlaylistsView(); }
  else if (view === "history") { byId("viewTitle").innerHTML = `<span class="hex" aria-hidden="true"></span>Historique`; loadHistoryView(); }
}

async function loadDiscoverView() {
  const list = byId("cat");
  list.setAttribute("aria-busy", "true");
  // Connecté → recommandations « Pour toi » (repli tendances) ; sinon tendances.
  let rows = acct.auth.isAuthed ? await acct.loadRecommendations() : [];
  if (!rows.length) rows = await acct.loadTrending(30);
  state.tracks = rows;
  renderList();
  list.setAttribute("aria-busy", "false");
}

async function loadHistoryView() {
  const list = byId("cat");
  if (!acct.auth.isAuthed) { state.tracks = []; renderList(); return; }
  list.setAttribute("aria-busy", "true");
  state.tracks = await acct.loadHistory();
  renderList();
  list.setAttribute("aria-busy", "false");
}

async function loadFavoritesView() {
  const list = byId("cat");
  if (!acct.auth.isAuthed) { state.tracks = []; renderList(); return; }
  list.setAttribute("aria-busy", "true");
  const rows = await acct.loadFavorites();
  state.tracks = rows;
  renderList();
  list.setAttribute("aria-busy", "false");
}

function renderPlaylistsView() {
  const list = byId("cat");
  byId("count").textContent = "";
  if (!acct.auth.isAuthed) {
    list.innerHTML = `<div class="cat-empty"><div class="cat-empty-ico" aria-hidden="true">≡</div><p>Connecte-toi pour créer des playlists.</p><button class="ghost-btn" id="emptyLogin" type="button">Connexion</button></div>`;
    byId("emptyLogin")?.addEventListener("click", openAuthModal);
    return;
  }
  const pls = acct.playlists;
  const grid = document.createElement("div");
  grid.className = "pl-grid";
  // Carte « créer ».
  const create = document.createElement("button");
  create.className = "pl-card pl-new";
  create.type = "button";
  create.innerHTML = `<span class="pl-new-ico">＋</span><span>Nouvelle playlist</span>`;
  create.addEventListener("click", async () => {
    const name = prompt("Nom de la playlist ?");
    if (name && name.trim()) { await acct.createPlaylist(name.trim()); renderPlaylistsView(); }
  });
  grid.appendChild(create);
  for (const pl of pls) {
    const card = document.createElement("article");
    card.className = "pl-card";
    card.innerHTML = `
      <button class="pl-open" type="button">
        <span class="pl-art">♪</span>
        <span class="pl-name">${esc(pl.name)}</span>
        <span class="pl-count">${pl.trackCount} piste${pl.trackCount > 1 ? "s" : ""}</span>
      </button>
      <button class="pl-del" type="button" aria-label="Supprimer la playlist">✕</button>`;
    card.querySelector(".pl-open").addEventListener("click", () => openPlaylist(pl.id));
    card.querySelector(".pl-del").addEventListener("click", async () => {
      if (confirm(`Supprimer « ${pl.name} » ?`)) { await acct.deletePlaylist(pl.id); renderPlaylistsView(); }
    });
    grid.appendChild(card);
  }
  list.innerHTML = "";
  list.appendChild(grid);
}

async function openPlaylist(id) {
  const list = byId("cat");
  list.setAttribute("aria-busy", "true");
  try {
    const pl = await acct.getPlaylist(id);
    state.view = "playlist";
    state.openPlaylistId = id;
    state.tracks = pl.tracks || [];
    setActiveTab("playlists");
    showControls(false);
    byId("viewTitle").innerHTML = `<button class="back-btn" id="plBack" type="button" aria-label="Retour aux playlists">←</button>${esc(pl.name)}`;
    renderList();
    byId("plBack")?.addEventListener("click", () => switchView("playlists"));
  } catch {
    announce("Playlist introuvable.");
    switchView("playlists");
  } finally {
    list.setAttribute("aria-busy", "false");
  }
}

async function onRemoveFromPlaylist(trackId) {
  if (!state.openPlaylistId) return;
  try {
    await acct.removeFromPlaylist(state.openPlaylistId, trackId);
    openPlaylist(state.openPlaylistId);
  } catch { announce("Impossible de retirer la piste."); }
}

/* ───────────────── Modale : ajouter à une playlist ───────────────── */
function openPlaylistPicker(trackId) {
  if (!acct.auth.isAuthed) { openAuthModal(); return; }
  state.pickTrackId = trackId;
  renderPlaylistPicker();
  byId("plErr").hidden = true;
  showModal("plModal");
}

function renderPlaylistPicker() {
  const box = byId("plPicker");
  box.innerHTML = "";
  if (!acct.playlists.length) {
    box.innerHTML = `<p class="fine">Aucune playlist. Crée-en une ci-dessous.</p>`;
    return;
  }
  for (const pl of acct.playlists) {
    const b = document.createElement("button");
    b.className = "pl-pick-item";
    b.type = "button";
    b.innerHTML = `<span>${esc(pl.name)}</span><span class="fine">${pl.trackCount}</span>`;
    b.addEventListener("click", async () => {
      try {
        await acct.addToPlaylist(pl.id, state.pickTrackId);
        hideModal("plModal");
        announce("Ajouté à la playlist.");
      } catch (e) {
        byId("plErr").textContent = e.message || "Erreur";
        byId("plErr").hidden = false;
      }
    });
    box.appendChild(b);
  }
}

/* ───────────────── Compte (header + modale auth) ───────────────── */
function renderAccount() {
  const box = byId("acct");
  if (acct.auth.isAuthed) {
    const name = acct.auth.listener.displayName || acct.auth.listener.email;
    box.innerHTML = `
      <div class="acct-menu">
        <button class="acct-btn acct-user" id="acctUser" type="button" aria-haspopup="true" aria-expanded="false">
          <span class="acct-avatar">${esc(initials(name))}</span>
          <span class="acct-name">${esc(name)}</span>
        </button>
        <div class="acct-drop" id="acctDrop" hidden>
          <button type="button" id="acctHistory">Historique</button>
          <button type="button" id="acctLogout">Déconnexion</button>
        </div>
      </div>`;
    const drop = byId("acctDrop");
    byId("acctUser").addEventListener("click", () => {
      const open = drop.hidden;
      drop.hidden = !open;
      byId("acctUser").setAttribute("aria-expanded", String(open));
    });
    byId("acctHistory").addEventListener("click", () => { byId("acctDrop").hidden = true; switchView("history"); });
    byId("acctLogout").addEventListener("click", async () => {
      await acct.logout();
      if (state.view !== "catalog") switchView("catalog");
    });
  } else {
    box.innerHTML = `<button class="acct-btn" id="loginBtn" type="button">Connexion</button>`;
    byId("loginBtn").addEventListener("click", openAuthModal);
  }
}

let authMode = "login";
function openAuthModal() {
  setAuthMode("login");
  byId("authErr").hidden = true;
  showModal("authModal");
  setTimeout(() => byId("afEmail")?.focus(), 50);
}
function setAuthMode(mode) {
  authMode = mode;
  byId("tabLogin").classList.toggle("on", mode === "login");
  byId("tabRegister").classList.toggle("on", mode === "register");
  byId("nameField").hidden = mode !== "register";
  byId("afName").required = mode === "register";
  byId("afPass").setAttribute("autocomplete", mode === "register" ? "new-password" : "current-password");
  byId("authSubmit").textContent = mode === "register" ? "Créer mon compte" : "Se connecter";
}

async function submitAuth(e) {
  e.preventDefault();
  const email = byId("afEmail").value.trim();
  const password = byId("afPass").value;
  const displayName = byId("afName").value.trim();
  const err = byId("authErr");
  err.hidden = true;
  byId("authSubmit").disabled = true;
  try {
    if (authMode === "register") await acct.register({ email, password, displayName });
    else await acct.login({ email, password });
    hideModal("authModal");
    byId("authForm").reset();
  } catch (ex) {
    err.textContent = ex.message || "Échec de la connexion";
    err.hidden = false;
  } finally {
    byId("authSubmit").disabled = false;
  }
}

/* ───────────────── Modales (générique) ───────────────── */
let modalLastFocus = null;
function modalFocusables(m) {
  return [...m.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
}
function showModal(id) {
  const m = byId(id);
  modalLastFocus = document.activeElement; // pour restaurer le focus à la fermeture
  m.hidden = false;
  document.body.classList.add("modal-open");
  (modalFocusables(m)[0] || m).focus();
}
function hideModal(id) {
  byId(id).hidden = true;
  if (!document.querySelector(".modal:not([hidden])")) document.body.classList.remove("modal-open");
  // Restaure le focus sur le déclencheur ; s'il a été détaché (ex. le menu compte
  // s'est re-rendu après connexion), on se rabat sur un élément stable du header
  // compte pour ne pas renvoyer le focus sur <body>.
  const target = (modalLastFocus && document.contains(modalLastFocus))
    ? modalLastFocus
    : byId("acct")?.querySelector("button, a[href]");
  target?.focus?.();
  modalLastFocus = null;
}
function wireModals() {
  document.querySelectorAll(".modal").forEach((m) => {
    m.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", () => hideModal(m.id)));
  });
  document.addEventListener("keydown", (e) => {
    const open = document.querySelector(".modal:not([hidden])");
    if (!open) return;
    if (e.key === "Escape") { hideModal(open.id); return; }
    if (e.key !== "Tab") return;
    // Piège de focus : le Tab reste dans la modale ouverte.
    const f = modalFocusables(open);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  byId("tabLogin").addEventListener("click", () => { setAuthMode("login"); byId("authErr").hidden = true; });
  byId("tabRegister").addEventListener("click", () => { setAuthMode("register"); byId("authErr").hidden = true; });
  byId("authForm").addEventListener("submit", submitAuth);
  byId("plCreateForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = byId("plNewName").value.trim();
    if (!name) return;
    try {
      const pl = await acct.createPlaylist(name);
      byId("plNewName").value = "";
      await acct.addToPlaylist(pl.id, state.pickTrackId);
      hideModal("plModal");
      announce("Playlist créée et piste ajoutée.");
    } catch (ex) {
      byId("plErr").textContent = ex.message || "Erreur";
      byId("plErr").hidden = false;
    }
  });
}

function wireTabs() {
  document.querySelectorAll("#tabs .tab").forEach((b) => {
    b.addEventListener("click", () => switchView(b.dataset.view));
  });
}

/* ───────────────── Init ───────────────── */
function restorePrefs() {
  try {
    const v = localStorage.getItem(LS.volume);
    if (v !== null) { audio.volume = Number(v); byId("vol").value = v; }
    state.shuffle = localStorage.getItem(LS.shuffle) === "1";
    state.repeat = localStorage.getItem(LS.repeat) === "1";
    if (state.shuffle) { byId("pShuffle").classList.add("on"); byId("pShuffle").setAttribute("aria-pressed", "true"); }
    if (state.repeat) { byId("pRepeat").classList.add("on"); byId("pRepeat").setAttribute("aria-pressed", "true"); }
  } catch {}
}

function init() {
  const y = byId("y"); if (y) y.textContent = String(new Date().getFullYear());
  restorePrefs();
  wireControls();
  wireTabs();
  wireModals();
  renderAccount();

  // Re-render sur changements d'auth / bibliothèque.
  acct.on("authchange", () => {
    renderAccount();
    if (state.view === "favorites") loadFavoritesView();
    else if (state.view === "playlists") renderPlaylistsView();
    else if (state.view === "discover") loadDiscoverView();
    else if (state.view === "history") loadHistoryView();
    else refreshHearts();
  });
  acct.on("favchange", () => { if (state.view !== "favorites") refreshHearts(); });
  acct.on("playlistschange", () => { renderPlaylistPicker(); });

  loadGenres();
  loadTracks();
  acct.initSession(); // restaure la session si cookie de refresh valide
}

init();
