/* En Ondes — Hub d'écoute multi-stations (player universel + recherche, filtres,
 * favoris, fiche station).
 *
 * Lit enondes-site/stations.json (généré par scripts/build-stations.mjs),
 * affiche la grille, et joue n'importe quelle station dans UN seul <audio>
 * qu'on switche au runtime — façon iHeart/Stingray. Le flux audio joue en
 * cross-domaine sans souci (les <audio> ne sont pas soumis au CORS) ; les
 * titres now-playing passent par le proxy same-origin /np/<slug> (nginx).
 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const LS = { station: "eo.station", volume: "eo.volume", muted: "eo.muted", favs: "eo.favs", playing: "eo.playing" };

const state = {
  stations: [],
  current: null,
  playing: false,
  intent: false, // l'utilisateur veut-il que ça joue ? (garde la reconnexion)
  favs: new Set(),
  filter: { q: "", genre: null, favsOnly: false },
  npTimer: null,
  reconnectTimer: null,
  reconnectAttempt: 0,
  watchdog: null,
  lastPos: 0,
  lastTrackKey: "",
  track: null, // {artist,title} courant
  cover: null,
};

// Stations dont l'animation d'apparition a déjà joué (anti ré-animation au rendu).
const enteredCards = new Set();

const audio = new Audio();
audio.preload = "none";
// NE PAS poser crossOrigin : le flux joue cross-domaine sans exiger de CORS.

/* ───────────────── Utilitaires ───────────────── */
const initials = (name) =>
  (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
// Encre lisible (foncée ou blanche) selon la luminance de la couleur d'accent.
const ink = (hex) => {
  const h = (hex || "").replace("#", "");
  if (h.length < 6) return "#fff";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#08111f" : "#fff";
};
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
// Échappement HTML : les champs de station peuvent venir de radios TIERCES
// (brand/partners.json) → jamais injecter brut dans innerHTML.
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const byId = (id) => document.getElementById(id);
const prefersReducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function setAccent(st) {
  const r = document.documentElement.style;
  r.setProperty("--accent", st.colors.accent);
  r.setProperty("--accent-bright", st.colors.accentBright);
  r.setProperty("--glow", st.colors.glowRgb);
}

function parseTrack(s) {
  let str = (s || "").trim().replace(/\s+\?\s+/g, " - ").trim();
  if (!str) return null;
  const parts = str.split(" - ").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { artist: parts[parts.length - 2], title: parts[parts.length - 1] };
  return { artist: "", title: parts[0] || str };
}

async function fetchTimeout(url, opts = {}, ms = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

async function fetchNowPlaying(url) {
  if (!url) return null;
  try {
    const r = await fetchTimeout(url, { mode: "cors", cache: "no-store" }, 6000);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const d = await r.json();
      const t = d?.data?.current_track || d?.track || d?.now_playing || d?.current || d;
      const title = (t?.title || t?.song || t?.now_playing_title || "").toString().slice(0, 200);
      const artist = (t?.artist || t?.now_playing_artist || "").toString().slice(0, 200);
      return title ? { artist, title } : null;
    }
    const txt = (await r.text()).slice(0, 1000);
    if (txt.includes("<")) {
      const cols = txt.replace(/<[^>]+>/g, "").trim().split(",");
      return cols.length >= 7 ? parseTrack(cols.slice(6).join(",").trim()) : null;
    }
    return parseTrack(txt);
  } catch { return null; }
}

const coverCache = new Map();
async function fetchCover(artist, title) {
  const key = `${artist}|${title}`.toLowerCase();
  if (coverCache.has(key)) return coverCache.get(key);
  try {
    const term = encodeURIComponent(`${artist} ${title}`.trim());
    const r = await fetchTimeout(`https://itunes.apple.com/search?media=music&entity=song&limit=1&term=${term}`, { mode: "cors" }, 6000);
    const d = await r.json();
    const raw = d?.results?.[0]?.artworkUrl100;
    const url = typeof raw === "string" ? raw.replace(/^http:/, "https:").replace("100x100", "300x300") : null;
    coverCache.set(key, url);
    return url;
  } catch { coverCache.set(key, null); return null; }
}

/* ───────────────── Favoris ───────────────── */
function loadFavs() {
  try { state.favs = new Set(JSON.parse(localStorage.getItem(LS.favs) || "[]")); } catch { state.favs = new Set(); }
}
// Annonce un message ponctuel aux lecteurs d'écran (région #eoLive).
function announce(msg) {
  const el = byId("eoLive");
  if (el) el.textContent = msg;
}
function toggleFav(slug) {
  const fav = !state.favs.has(slug);
  fav ? state.favs.add(slug) : state.favs.delete(slug);
  try { localStorage.setItem(LS.favs, JSON.stringify([...state.favs])); } catch {}
  // MAJ de la carte EN PLACE (préserve le focus clavier, pas de renderGrid complet).
  const st = stationBySlug(slug);
  const card = byId("grid")?.querySelector(`.station[data-slug="${slug}"]`);
  const btn = card?.querySelector(".fav[data-act='fav']");
  if (btn) {
    btn.classList.toggle("on", fav);
    btn.setAttribute("aria-pressed", String(fav));
    btn.setAttribute("aria-label", fav ? "Retirer des favoris" : "Ajouter aux favoris");
  }
  const name = st ? st.shortName : "Station";
  announce(fav ? `${name} ajoutée aux favoris` : `${name} retirée des favoris`);
}

/* ───────────────── Filtres ───────────────── */
function visibleStations() {
  const { q, genre, favsOnly } = state.filter;
  const nq = norm(q);
  let list = state.stations.filter((st) => {
    if (favsOnly && !state.favs.has(st.slug)) return false;
    if (genre && st.genre !== genre) return false;
    if (nq && !(norm(st.name).includes(nq) || norm(st.genre).includes(nq))) return false;
    return true;
  });
  // Favoris d'abord, puis ordre du manifeste.
  return list.sort((a, b) => (state.favs.has(b.slug) ? 1 : 0) - (state.favs.has(a.slug) ? 1 : 0));
}

function renderFilters() {
  const genres = [...new Set(state.stations.map((s) => s.genre).filter(Boolean))];
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
  box.appendChild(chip("Toutes", !state.filter.genre && !state.filter.favsOnly, () => {
    state.filter.genre = null; state.filter.favsOnly = false; renderFilters(); renderGrid();
  }));
  box.appendChild(chip("★ Favoris", state.filter.favsOnly, () => {
    state.filter.favsOnly = !state.filter.favsOnly; state.filter.genre = null; renderFilters(); renderGrid();
  }));
  for (const g of genres) {
    box.appendChild(chip(g, state.filter.genre === g, () => {
      state.filter.genre = state.filter.genre === g ? null : g;
      state.filter.favsOnly = false; renderFilters(); renderGrid();
    }));
  }
}

// Réinitialise recherche + filtres (déclenché depuis l'état vide actionnable, QW-2).
function resetFilters() {
  state.filter.q = "";
  state.filter.genre = null;
  state.filter.favsOnly = false;
  const qInput = byId("q");
  if (qInput) qInput.value = "";
  renderFilters();
  renderGrid();
}

/* ───────────────── Grille ───────────────── */
function stationCard(st) {
  const card = document.createElement("article");
  card.className = `station ${st.status === "coming" ? "coming" : ""}`;
  card.dataset.slug = st.slug;
  card.style.setProperty("--st-accent", st.colors.accent);
  card.style.setProperty("--st-accent-bright", st.colors.accentBright);
  card.style.setProperty("--st-glow", st.colors.glowRgb);
  card.style.setProperty("--st-ink", ink(st.colors.accentBright));
  const fav = state.favs.has(st.slug);
  card.innerHTML = `
    <span class="badge ${st.status === "coming" ? "coming" : "live"}">${st.status === "coming" ? "Bientôt" : "En ondes"}</span>
    <button class="fav ${fav ? "on" : ""}" data-act="fav" type="button" aria-pressed="${fav}" aria-label="${fav ? "Retirer des favoris" : "Ajouter aux favoris"}" title="Favori">
      <svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-10-9.3C.6 8.7 2 5.5 5.2 5.5c1.9 0 3.2 1.1 3.8 2.3C9.6 6.6 10.9 5.5 12.8 5.5 16 5.5 17.4 8.7 16 11.7 13.5 16.4 12 21 12 21z"/></svg>
    </button>
    <button class="playarea" data-act="play" type="button" aria-label="${st.status === "coming" ? `${esc(st.shortName)} — bientôt en ondes, voir les détails` : `Écouter ${esc(st.shortName)}`}">
      <span class="art">
        <span class="vinyl"><span class="label">${esc(initials(st.shortName))}</span></span>
        <span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      </span>
      <span class="meta">
        <span class="name">${esc(st.shortName)}</span>
        <span class="genre">${st.genre ? esc(st.genre) : "&nbsp;"}</span>
        <span class="flag"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> Écouter en direct</span>
      </span>
    </button>
    <button class="info" data-act="info" type="button" aria-label="Détails ${esc(st.shortName)}" title="Détails">
      <svg viewBox="0 0 24 24"><path d="M11 7h2v2h-2zM11 11h2v6h-2zM12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z"/></svg>
    </button>
    <button class="share" data-act="share" type="button" aria-label="Partager ${esc(st.shortName)}" title="Partager">
      <svg viewBox="0 0 24 24"><path d="M18 16.1a3 3 0 0 0-2.3 1.1l-6.8-3.9a3 3 0 0 0 0-2.6l6.8-3.9A3 3 0 1 0 15 4a3 3 0 0 0 .1.7L8.3 8.6a3 3 0 1 0 0 6.8l6.8 3.9a3 3 0 1 0 2.9-3.2z"/></svg>
    </button>`;
  return card;
}

function renderGrid() {
  const grid = byId("grid");
  const list = visibleStations();
  const count = byId("count");
  if (count) count.textContent = `${list.length} station${list.length > 1 ? "s" : ""}`;
  grid.innerHTML = "";
  if (!list.length) {
    // État vide ACTIONNABLE (QW-2) : message contextuel + bouton pour repartir,
    // au lieu d'un cul-de-sac. Les libellés sont statiques (aucune injection).
    const favsOnly = state.filter.favsOnly;
    const msg = favsOnly
      ? "Aucune station en favori pour l'instant."
      : "Aucune station ne correspond à ta recherche.";
    const cta = favsOnly ? "Voir toutes les stations" : "Réinitialiser la recherche";
    grid.innerHTML = `<div class="empty empty--cta"><p>${msg}</p><button class="chip on" type="button" id="resetFilters">${cta}</button></div>`;
    byId("resetFilters")?.addEventListener("click", resetFilters);
    markActiveCard();
    return;
  }
  // Découverte par lieu (façon TuneIn) : on regroupe par région. Les en-têtes de
  // section ne s'affichent que s'il y a ≥2 groupes (sinon grille plate, sans bruit).
  const groups = groupByRegion(list);
  let i = 0;
  const appendCard = (st) => {
    const card = stationCard(st);
    if (!enteredCards.has(st.slug)) {
      card.classList.add("station--enter");
      card.style.animationDelay = `${Math.min(i * 45, 360)}ms`;
      enteredCards.add(st.slug);
    }
    grid.appendChild(card);
    i++;
  };
  if (groups.length <= 1) {
    list.forEach(appendCard);
  } else {
    for (const g of groups) {
      const h = document.createElement("h3");
      h.className = "grid-section";
      h.textContent = g.label;
      grid.appendChild(h);
      g.stations.forEach(appendCard);
    }
  }
  markActiveCard();
}

// Regroupe une liste de stations par région, dans l'ordre d'apparition du manifeste.
// Les stations sans région tombent dans « Autres stations » (placé en dernier).
function groupByRegion(list) {
  const order = [];
  const map = new Map();
  for (const st of list) {
    const key = st.region || "";
    if (!map.has(key)) { map.set(key, []); order.push(key); }
    map.get(key).push(st);
  }
  return order
    .sort((a, b) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0)) // « Autres » (clé vide) en dernier
    .map((key) => ({ label: key || "Autres stations", stations: map.get(key) }));
}

function markActiveCard() {
  for (const c of $$(".station")) {
    const on = c.dataset.slug === state.current?.slug;
    c.classList.toggle("active", on);
    c.classList.toggle("paused", on && !state.playing);
    // État du bouton lecture de la carte pour les lecteurs d'écran (stations en ondes)
    const play = c.querySelector(".playarea[data-act='play']");
    const st = stationBySlug(c.dataset.slug);
    if (play && st && st.status !== "coming") {
      const name = st.shortName;
      const playing = on && state.playing;
      play.setAttribute("aria-pressed", String(playing));
      play.setAttribute("aria-label", playing ? `Pause ${name} (en lecture)` : `Écouter ${name}`);
    }
  }
}

function stationBySlug(slug) { return state.stations.find((s) => s.slug === slug); }

/* ───────────────── Deep-link & partage ───────────────── */
// Lien profond partageable vers une station : https://…/?station=<slug>.
function stationUrl(slug) {
  const u = new URL(location.href);
  u.searchParams.set("station", slug);
  u.searchParams.delete("play"); // le flag de raccourci PWA ne reste pas dans l'URL
  return u;
}
// Reflète la station courante dans l'URL sans recharger (lien copiable/partageable).
function updateUrl(slug) {
  try { history.replaceState(null, "", stationUrl(slug)); } catch {}
}
// Partage natif (navigator.share) avec repli copie-presse-papier.
async function shareStation(st) {
  if (!st) return;
  const url = stationUrl(st.slug).toString();
  const title = `${st.name} · En Ondes`;
  const text = st.status === "coming"
    ? `${st.name} arrive bientôt sur En Ondes`
    : `J'écoute ${st.name} en direct sur En Ondes`;
  try {
    if (navigator.share) { await navigator.share({ title, text, url }); return; }
  } catch (e) {
    if (e?.name === "AbortError") return; // partage annulé par l'utilisateur
  }
  try { await navigator.clipboard.writeText(url); announce("Lien de la station copié"); }
  catch { announce(url); }
}

/* ───────────────── Player ───────────────── */
function selectStation(st, autoplay) {
  if (!st || st.status === "coming" || !st.stream) return;
  const switching = state.current?.slug !== st.slug;
  state.current = st;
  store(LS.station, st.slug);
  updateUrl(st.slug);

  // Mise à jour visuelle du lecteur (accent, textes, pochette, carte active).
  const applyVisuals = () => {
    setAccent(st);
    byId("player").classList.add("show");
    byId("pStation").textContent = st.name;
    byId("pTrack").textContent = st.shortName;
    byId("pSub").textContent = st.genre || "En direct";
    state.track = null; state.cover = null;
    setCover(null, st);
    markActiveCard();
    updateHeroOnair();
    if (sheetOpenFor() === st.slug) renderSheet(st); // ne rafraîchit la fiche que si elle montre CETTE station
  };
  // Fondu-enchaîné au changement de station (View Transitions API), avec repli
  // direct si l'API est absente ou si l'utilisateur préfère un mouvement réduit.
  if (switching && document.startViewTransition && !prefersReducedMotion()) {
    document.startViewTransition(applyVisuals);
  } else {
    applyVisuals();
  }
  updateMediaSession({ title: st.shortName, artist: st.genre || "En direct" }, st);

  if (switching) {
    stopReconnect();
    state.lastTrackKey = "";
    audio.src = `${st.stream}${st.stream.includes("?") ? "&" : "?"}_=${Date.now()}`;
  }
  if (autoplay) startPlayback();
  restartNowPlaying();
}

function setLoadingUI(on) {
  for (const id of ["pPlay", "sheetPlay"]) byId(id)?.classList.toggle("is-loading", on);
}
async function startPlayback() {
  state.intent = true;
  store(LS.playing, "1"); // mémorise l'intention d'écoute pour la reprise de session (QW-3)
  hideResumePrompt();
  setLoadingUI(true);
  try {
    if (!audio.src && state.current) audio.src = state.current.stream;
    await audio.play();
  } catch (e) { setPlayingUI(false); console.warn("[hub] lecture refusée", e?.message || e); }
  finally { setLoadingUI(false); }
}
function pausePlayback() { state.intent = false; store(LS.playing, "0"); audio.pause(); }
function togglePlay() { audio.paused ? startPlayback() : pausePlayback(); }

function setPlayingUI(on, label) {
  state.playing = on;
  for (const id of ["pPlay", "sheetPlay"]) {
    const btn = byId(id);
    if (!btn) continue;
    btn.classList.toggle("is-playing", on);
    btn.setAttribute("aria-label", on ? "Pause" : "Lecture");
    btn.innerHTML = on ? ICON.pause : ICON.play;
  }
  if (label) byId("pSub").textContent = label;
  byId("player").classList.toggle("playing", on);
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = on ? "playing" : "paused";
  markActiveCard();
}

function liveStations() { return state.stations.filter((s) => s.status !== "coming" && s.stream); }
function step(dir) {
  const live = liveStations();
  if (!live.length) return;
  const i = Math.max(0, live.findIndex((s) => s.slug === state.current?.slug));
  selectStation(live[(i + dir + live.length) % live.length], true);
}

/* ───────────────── Now-playing ───────────────── */
function restartNowPlaying() {
  clearInterval(state.npTimer);
  pollNowPlaying();
  state.npTimer = setInterval(pollNowPlaying, 15000);
}
async function pollNowPlaying() {
  const st = state.current;
  if (!st) return;
  const np = await fetchNowPlaying(st.nowPlaying);
  if (!st || st.slug !== state.current?.slug) return;
  if (!np || !np.title) {
    state.track = null;
    byId("pTrack").textContent = st.shortName;
    byId("pSub").textContent = st.genre || "En direct";
    updateHeroOnair();
    if (sheetOpenFor() === st.slug) renderSheetTrack(st);
    return;
  }
  state.track = np;
  byId("pTrack").textContent = np.title;
  byId("pSub").textContent = np.artist || "En direct";
  updateMediaSession(np, st);
  updateHeroOnair();
  if (sheetOpenFor() === st.slug) renderSheetTrack(st);
  const key = `${np.artist}|${np.title}`.toLowerCase();
  if (key !== state.lastTrackKey) {
    state.lastTrackKey = key;
    if (np.artist) {
      const cover = await fetchCover(np.artist, np.title);
      if (st.slug === state.current?.slug) { state.cover = cover; setCover(cover, st); if (sheetOpenFor() === st.slug) renderSheet(st); }
    }
  }
}

function setCover(url, st) {
  const box = byId("pCover");
  box.innerHTML = url ? `<img src="${esc(url)}" alt="" />` : `<span class="mono">${esc(initials(st.shortName))}</span>`;
  box.style.background = `linear-gradient(150deg, ${st.colors.accent}, #0a0a0a)`;
}

/* Lower-third « En ondes » sur l'image studio (station + titre en direct). */
function updateHeroOnair() {
  const st = state.current;
  const stEl = byId("heroStation"), tkEl = byId("heroTrack");
  if (!stEl || !tkEl) return;
  if (!st) { stEl.textContent = "En Ondes"; tkEl.textContent = " · choisis une station"; return; }
  stEl.textContent = st.name;
  if (state.track && state.track.title) {
    tkEl.textContent = ` · ${state.track.title}${state.track.artist ? " — " + state.track.artist : ""}`;
  } else {
    tkEl.textContent = ` · ${st.genre || "en direct"}`;
  }
}

/* Horloge studio (heure de Montréal). Formateur Intl créé une seule fois. */
let clockFmt = null;
let clockNodes = null; // { hhmm: TextNode, ss: TextNode } — mutés au lieu de innerHTML
function tickClock() {
  const el = byId("clock");
  if (!el) return;
  try {
    if (!clockFmt) clockFmt = new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const p = clockFmt.formatToParts(new Date());
    const g = (t) => (p.find((x) => x.type === t) || {}).value || "--";
    const hh = g("hour"), mm = g("minute"), ss = g("second");
    // Structure construite une seule fois ; ensuite on ne mute que les nœuds texte.
    if (!clockNodes) {
      el.textContent = "";
      const hhmm = document.createTextNode("");
      const b = document.createElement("b");
      const ssNode = document.createTextNode("");
      b.appendChild(ssNode);
      el.appendChild(hhmm); el.appendChild(b);
      clockNodes = { hhmm, ss: ssNode };
    }
    clockNodes.hhmm.nodeValue = `${hh}:${mm}`;
    clockNodes.ss.nodeValue = `:${ss}`;
    el.setAttribute("datetime", `${hh}:${mm}:${ss}`);
    el.setAttribute("aria-label", `Heure de Montréal : ${hh} h ${mm}`);
  } catch {}
}

/* ───────────────── MediaSession ───────────────── */
function updateMediaSession(track, st) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || st.shortName,
      artist: track.artist || st.genre || "En direct",
      album: `${st.name} · En Ondes`,
    });
  } catch {}
}
function wireMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const set = (a, h) => { try { navigator.mediaSession.setActionHandler(a, h); } catch {} };
  set("play", () => startPlayback());
  set("pause", () => pausePlayback());
  set("stop", () => pausePlayback());
  set("nexttrack", () => step(1));
  set("previoustrack", () => step(-1));
}

/* ───────────────── Reconnexion ───────────────── */
function scheduleReconnect(reason) {
  if (!state.intent) return; // pas de reconnexion si l'utilisateur n'a pas demandé à jouer
  if (state.reconnectTimer || !state.current) return;
  // Échec définitif : on borne les tentatives pour ne pas boucler indéfiniment.
  if (state.reconnectAttempt > 6) {
    stopReconnect();
    state.intent = false;
    setPlayingUI(false, "Flux indisponible — appuie sur lecture");
    announce("Flux indisponible — appuie sur lecture");
    return;
  }
  state.reconnectAttempt++;
  const delay = Math.min(15000, 1000 * 2 ** (state.reconnectAttempt - 1));
  setPlayingUI(false, `Reconnexion… (${state.reconnectAttempt})`);
  console.info(`[hub] reconnect (${reason}) dans ${delay}ms`);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    if (!state.current) return;
    audio.src = `${state.current.stream}${state.current.stream.includes("?") ? "&" : "?"}_=${Date.now()}`;
    startPlayback();
  }, delay);
}
function stopReconnect() {
  if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
  state.reconnectAttempt = 0;
}
function wireAudio() {
  audio.addEventListener("playing", () => { stopReconnect(); setPlayingUI(true); });
  audio.addEventListener("pause", () => { if (!state.reconnectTimer) setPlayingUI(false); });
  audio.addEventListener("stalled", () => { if (!audio.paused) scheduleReconnect("stalled"); });
  audio.addEventListener("ended", () => scheduleReconnect("ended"));
  audio.addEventListener("error", () => { if (state.current) scheduleReconnect("error"); });
  audio.addEventListener("waiting", () => setPlayingUI(state.playing, "Mise en mémoire…"));
  clearInterval(state.watchdog);
  state.watchdog = setInterval(() => {
    if (audio.paused || state.reconnectTimer) { state.lastPos = audio.currentTime; return; }
    if (audio.currentTime > 0 && audio.currentTime === state.lastPos) scheduleReconnect("watchdog");
    state.lastPos = audio.currentTime;
  }, 12000);
  window.addEventListener("online", () => { if (state.current && !audio.paused) scheduleReconnect("online"); });
}

/* ───────────────── Réseau (bannière hors-ligne) ───────────────── */
function wireNetwork() {
  const sync = () => {
    const off = !navigator.onLine;
    document.body.classList.toggle("is-offline", off);
    const bar = byId("netbar");
    if (bar) bar.hidden = !off;
    if (off) announce("Hors-ligne — lecture en direct indisponible");
  };
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  sync();
}

/* ───────────────── Reprise de session (QW-3) ───────────────── */
/* L'autoplay est bloqué par le navigateur sans geste utilisateur : plutôt qu'un
 * échec muet, on propose une reprise EN UN TAP de la dernière station écoutée. */
let resumeTimer = null;
function showResumePrompt(st) {
  const bar = byId("resumeBar");
  if (!bar) return;
  const txt = bar.querySelector(".resume-txt");
  if (txt) txt.textContent = `Reprendre ${st.shortName} ?`;
  bar.hidden = false;
  requestAnimationFrame(() => bar.classList.add("show")); // déclenche la transition d'entrée
  announce(`Reprendre l'écoute de ${st.shortName} ? Appuie sur Reprendre.`);
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(hideResumePrompt, 12000); // se retire seule après 12 s
}
function hideResumePrompt() {
  const bar = byId("resumeBar");
  if (!bar) return;
  clearTimeout(resumeTimer);
  bar.classList.remove("show");
  setTimeout(() => { bar.hidden = true; }, 300); // attend la fin de la transition
}

/* ───────────────── Volume ───────────────── */
function wireVolume() {
  const slider = byId("vol");
  const saved = parseFloat(load(LS.volume));
  audio.volume = Number.isFinite(saved) ? saved : 1;
  audio.muted = load(LS.muted) === "1";
  slider.value = String(audio.muted ? 0 : audio.volume);
  slider.addEventListener("input", () => {
    audio.muted = false;
    audio.volume = parseFloat(slider.value);
    store(LS.volume, slider.value); store(LS.muted, "0");
  });
}

/* ───────────────── Fiche station / now-playing étendu (sheet) ───────────────── */
let sheetSlug = null;
let sheetLastFocus = null;
function sheetOpenFor() { return byId("sheet").classList.contains("show") ? sheetSlug : null; }

// Neutralise l'arrière-plan (clavier + lecteurs d'écran) quand la fiche est ouverte.
function setBgInert(on) {
  for (const sel of ["main", "header.top", "#player"]) {
    const el = document.querySelector(sel);
    if (el) el.inert = on;
  }
}
function focusables(c) {
  return [...c.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
}
function trapTab(e) {
  const f = focusables(byId("sheet"));
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function openSheet(st) {
  if (!byId("sheet").classList.contains("show")) sheetLastFocus = document.activeElement; // déclencheur
  sheetSlug = st.slug;
  renderSheet(st);
  const sheet = byId("sheet");
  sheet.classList.add("show");
  sheet.setAttribute("aria-hidden", "false");
  setBgInert(true);
  byId("sheetClose").focus();
}
function closeSheet() {
  const sheet = byId("sheet");
  sheet.classList.remove("show");
  sheet.setAttribute("aria-hidden", "true");
  setBgInert(false);
  sheetSlug = null;
  if (sheetLastFocus && typeof sheetLastFocus.focus === "function") sheetLastFocus.focus();
  sheetLastFocus = null;
}
function renderSheet(st) {
  const isCurrent = state.current?.slug === st.slug;
  byId("sheetArt").style.background = `linear-gradient(150deg, ${st.colors.accent}, #0a0a0a)`;
  byId("sheetArt").innerHTML = (isCurrent && state.cover) ? `<img src="${esc(state.cover)}" alt="" />` : `<span class="mono">${esc(initials(st.shortName))}</span>`;
  byId("sheetName").textContent = st.name;
  byId("sheetGenre").textContent = st.genre || "";
  byId("sheetDesc").textContent = st.description || "";
  const play = byId("sheetPlay");
  if (st.status === "coming") {
    play.disabled = true; play.innerHTML = ICON.play; play.classList.remove("is-playing");
    byId("sheetComing").hidden = false;
  } else {
    play.disabled = false; byId("sheetComing").hidden = true;
    play.classList.toggle("is-playing", isCurrent && state.playing);
    play.innerHTML = (isCurrent && state.playing) ? ICON.pause : ICON.play;
  }
  const link = byId("sheetSite");
  if (st.site) { link.href = st.site; link.hidden = false; } else link.hidden = true;
  renderSheetTrack(st);
  // Sélecteur de stations
  const sw = byId("sheetSwitch");
  sw.innerHTML = "";
  for (const s of liveStations()) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `swchip ${s.slug === st.slug ? "on" : ""}`;
    b.style.setProperty("--st-accent", s.colors.accent);
    b.textContent = s.shortName;
    b.addEventListener("click", () => { selectStation(s, true); openSheet(s); });
    sw.appendChild(b);
  }
}
function renderSheetTrack(st) {
  const isCurrent = state.current?.slug === st.slug;
  const t = isCurrent ? state.track : null;
  byId("sheetTrack").textContent = t?.title || (st.status === "coming" ? "Bientôt en ondes" : "En direct");
  byId("sheetArtist").textContent = t?.artist || (isCurrent ? (st.genre || "") : st.genre || "");
}

/* ───────────────── localStorage ───────────────── */
function store(k, v) { try { localStorage.setItem(k, v); } catch {} }
function load(k) { try { return localStorage.getItem(k); } catch { return null; } }

/* ───────────────── Icônes ───────────────── */
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
};

/* ───────────────── Chargement des stations ───────────────── */
// Cartes squelette affichées pendant le fetch (évite le saut visuel / écran vide).
function renderSkeletons(n = 2) {
  const grid = byId("grid");
  if (!grid) return;
  grid.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const sk = document.createElement("article");
    sk.className = "station skeleton";
    sk.setAttribute("aria-hidden", "true");
    sk.innerHTML = `<span class="sk sk-art"></span><span class="sk sk-line"></span><span class="sk sk-line short"></span>`;
    grid.appendChild(sk);
  }
}

async function loadStations() {
  const grid = byId("grid");
  renderSkeletons();
  try {
    const r = await fetch("stations.json", { cache: "no-cache" });
    const data = await r.json();
    state.stations = Array.isArray(data?.stations) ? data.stations : [];
  } catch {
    // Erreur distincte du « vide » : message + bouton Réessayer branché sur loadStations.
    grid.innerHTML = `<div class="empty">Impossible de charger les stations.<br><button class="chip on" type="button" id="retryLoad">Réessayer</button></div>`;
    byId("retryLoad")?.addEventListener("click", loadStations);
    announce("Échec du chargement des stations.");
    return;
  }
  renderFilters();
  renderGrid();
  if (!state._wiredVolume) { wireVolume(); state._wiredVolume = true; }

  // Deep-link : ?station=<slug> (lien partagé) et ?play=1 (raccourci PWA).
  const params = new URLSearchParams(location.search);
  const wanted = stationBySlug(params.get("station") || "");
  const wantPlay = params.get("play") === "1";

  // Lien partagé vers une station pas encore en ondes : on montre sa fiche et on
  // s'arrête là — sélectionner une autre station réécrirait l'URL et créerait une
  // course avec l'animation de transition (fiche affichant la mauvaise station).
  if (wanted && wanted.status === "coming") { openSheet(wanted); return; }

  const last = stationBySlug(load(LS.station));
  const restore = (wanted && wanted.status !== "coming") ? wanted
    : (last && last.status !== "coming") ? last
    : liveStations()[0];
  if (restore) {
    selectStation(restore, false);
    // L'autoplay est bloqué sans geste : pour un lien profond ou le raccourci PWA,
    // on propose la lecture en un tap (même UX que la reprise de session QW-3).
    if ((wanted && wanted.slug === restore.slug) || wantPlay) {
      showResumePrompt(restore);
    } else if (last && restore.slug === last.slug && load(LS.playing) === "1") {
      showResumePrompt(restore);
    }
  }
}

/* ───────────────── Init ───────────────── */
async function init() {
  const y = byId("y"); if (y) y.textContent = new Date().getFullYear();
  loadFavs();
  wireAudio();
  wireMediaSession();
  setPlayingUI(false);
  tickClock();
  let clockTimer = setInterval(tickClock, 1000);
  // Onglet caché : on arrête l'horloge (la lecture audio, elle, continue en fond).
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { clearInterval(clockTimer); clockTimer = null; }
    else if (!clockTimer) { tickClock(); clockTimer = setInterval(tickClock, 1000); }
  });

  byId("pPlay").addEventListener("click", togglePlay);
  byId("pPrev").addEventListener("click", () => step(-1));
  byId("pNext").addEventListener("click", () => step(1));
  // Tap sur l'info du player → fiche now-playing étendue
  byId("pInfo").addEventListener("click", () => { if (state.current) openSheet(state.current); });

  // Reprise de session (QW-3)
  byId("resumeGo")?.addEventListener("click", () => { hideResumePrompt(); startPlayback(); });
  byId("resumeDismiss")?.addEventListener("click", hideResumePrompt);

  // Délégation des clics de carte
  byId("grid").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    const card = e.target.closest(".station");
    if (!act || !card) return;
    const st = stationBySlug(card.dataset.slug);
    if (!st) return;
    if (act.dataset.act === "fav") toggleFav(st.slug);
    else if (act.dataset.act === "info") openSheet(st);
    else if (act.dataset.act === "share") shareStation(st);
    else if (act.dataset.act === "play") {
      // Station « bientôt » : pas de flux → on ouvre la fiche au lieu de rester muet.
      if (st.status === "coming") { openSheet(st); return; }
      state.current?.slug === st.slug ? togglePlay() : selectStation(st, true);
    }
  });

  // Recherche (rendu débounced ~160ms pour ne pas reconstruire la grille à chaque frappe)
  let searchTimer = null;
  byId("q").addEventListener("input", (e) => {
    state.filter.q = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderGrid, 160);
  });

  // Sheet : fermeture
  byId("sheetClose").addEventListener("click", closeSheet);
  byId("sheetBackdrop").addEventListener("click", closeSheet);
  byId("sheetPlay").addEventListener("click", () => {
    const st = stationBySlug(sheetSlug); if (!st || st.status === "coming") return;
    state.current?.slug === st.slug ? togglePlay() : selectStation(st, true);
  });
  byId("sheetShare").addEventListener("click", () => { const st = stationBySlug(sheetSlug); if (st) shareStation(st); });
  document.addEventListener("keydown", (e) => {
    if (!sheetOpenFor()) return;
    if (e.key === "Escape") closeSheet();
    else if (e.key === "Tab") trapTab(e);
  });

  wireNetwork();
  // Squelettes affichés avant le fetch (init() pose 2 cartes d'attente via loadStations).
  await loadStations();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
