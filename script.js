/* =====================================================
   Hit Radio — Les Hits Dance Music
   Player persistant cross-page, MediaSession, PWA,
   horaire interactif, historique, partage, raccourcis.
   ===================================================== */

const STREAM_URL = "https://cast5.asurahosting.com/proxy/hitsdanc/stream";
const PANEL_URL = "https://cast5.asurahosting.com/start/hitsdanc/";
const NOWPLAYING_ENDPOINTS = [
  // CentovaCast public endpoints
  "https://cast5.asurahosting.com/cc-common/nowplaying.php?m=hitsdanc",
  "https://cast5.asurahosting.com/api/nowplaying/hitsdanc",
  "https://cast5.asurahosting.com/cast/api/v2.standard/account?username=hitsdanc&xml=0&f=json",
  // SHOUTcast standard 7.html (parfois bloque par CORS, mais essai)
  "https://cast5.asurahosting.com/proxy/hitsdanc/7.html",
  // Fallback : proxy CORS public (lit le 7.html via passerelle)
  "https://corsproxy.io/?https://cast5.asurahosting.com/proxy/hitsdanc/7.html",
  "https://api.allorigins.win/raw?url=https%3A%2F%2Fcast5.asurahosting.com%2Fproxy%2Fhitsdanc%2F7.html",
];
const ITUNES_SEARCH = "https://itunes.apple.com/search?media=music&entity=song&limit=1&term=";
const TIMEZONE = "America/Toronto";
const STORAGE = {
  vol: "hr.volume",
  mute: "hr.mute",
  playing: "hr.wasPlaying",
  history: "hr.history",
  resume: "hr.resumeOk",
  favs: "hr.favs",
  notifShow: "hr.notifShow",
  notifLastSlot: "hr.notifLastSlot",
  eq: "hr.eq",
  stats: "hr.stats",
};

/* -----------------------------------------------------
   1. Horaire structuré
   ----------------------------------------------------- */
const SLOT_TAGS = {
  morning:   { color: "#e8b84b", label: "Morning" },
  hitlist:   { color: "#c8102e", label: "Hit List" },
  drive:     { color: "#e07020", label: "Drive" },
  limelight: { color: "#7c44a8", label: "Limelight" },
  night:     { color: "#1a3055", label: "Nuits BeatRadioWorld" },
  special:   { color: "#2a7a6a", label: "Spécial" },
  audition:  { color: "#666",    label: "Audition" },
};

const SCHEDULE = {
  0: [
    ["00:00","07:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
    ["07:00","09:00","Hit List","Programmation","hitlist"],
    ["09:00","11:00","Disco Fever Experience","Programmation","special"],
    ["11:00","14:00","Hommage au Limelight Montréal","DJ Pierre Jutras","limelight"],
    ["14:00","15:00","DJ Jumpoff","DJ Jumpoff","drive"],
    ["15:00","17:00","Hits Dance Top 40 (reprise)","Programmation","hitlist"],
    ["17:00","19:00","Animateur en audition","Audition","audition"],
    ["19:00","20:00","Pee Jee Radio Show","Pee Jee","special"],
    ["20:00","21:00","Latino Show","DJ Isael Soccaras","special"],
    ["21:00","22:00","Franco chaud","Programmation","special"],
    ["22:00","24:00","Hot Slow Show","Programmation","limelight"],
  ],
  1: [
    ["00:00","07:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
    ["07:00","09:00","Les matins d'Alain (live)","Alain Perron","morning"],
    ["09:00","11:00","Hit List","Programmation","hitlist"],
    ["11:00","12:00","Latino Show","DJ Isael Soccaras","special"],
    ["12:00","16:00","Hit List","Programmation","hitlist"],
    ["16:00","18:00","Le Hit Drive (live)","Alain Perron","drive"],
    ["18:00","22:00","Hit List","Programmation","hitlist"],
    ["22:00","24:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
  ],
  2: [
    ["00:00","07:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
    ["07:00","09:00","Les matins d'Alain (live)","Alain Perron","morning"],
    ["09:00","16:00","Hit List","Programmation","hitlist"],
    ["16:00","18:00","Le Hit Drive (live)","Alain Perron","drive"],
    ["18:00","22:00","Hit List","Programmation","hitlist"],
    ["22:00","24:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
  ],
  3: [
    ["00:00","07:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
    ["07:00","09:00","Les matins d'Alain (live)","Alain Perron","morning"],
    ["09:00","12:00","Hit List","Programmation","hitlist"],
    ["12:00","14:00","Disco Fever Experience","Programmation","special"],
    ["14:00","16:00","Hit List (live)","Programmation","hitlist"],
    ["16:00","18:00","Le Hit Drive","Alain Perron","drive"],
    ["18:00","21:00","Hommage au Limelight Montréal","DJ Pierre Jutras","limelight"],
    ["21:00","22:00","DJ Jumpoff","DJ Jumpoff","drive"],
    ["22:00","24:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
  ],
  4: [
    ["00:00","07:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
    ["07:00","09:00","Les matins d'Alain (live)","Alain Perron","morning"],
    ["09:00","12:00","Hit List","Programmation","hitlist"],
    ["12:00","13:00","DJ Jumpoff","DJ Jumpoff","drive"],
    ["13:00","16:00","Hit List","Programmation","hitlist"],
    ["16:00","18:00","Le Hit Drive (live)","Alain Perron","drive"],
    ["18:00","21:00","Hit List","Programmation","hitlist"],
    ["21:00","22:00","DJ OSKANA","DJ OSKANA","special"],
    ["22:00","24:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
  ],
  5: [
    ["00:00","07:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
    ["07:00","09:00","Les matins d'Alain (live)","Alain Perron","morning"],
    ["09:00","16:00","Hit List","Programmation","hitlist"],
    ["16:00","18:00","Le Hit Drive (live)","Alain Perron","drive"],
    ["18:00","19:00","DJ Jumpoff","DJ Jumpoff","drive"],
    ["19:00","22:00","Hommage au Limelight Montréal","DJ Pierre Jutras","limelight"],
    ["22:00","24:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
  ],
  6: [
    ["00:00","07:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
    ["07:00","09:00","Hit List","Programmation","hitlist"],
    ["09:00","10:00","Latino Show","DJ Isael Soccaras","special"],
    ["10:00","12:00","Animateur en audition","Audition","audition"],
    ["12:00","14:00","Hits Dance Top 40","Programmation","hitlist"],
    ["14:00","17:00","Hit List","Programmation","hitlist"],
    ["17:00","18:00","DJ Jumpoff","DJ Jumpoff","drive"],
    ["18:00","21:00","Hommage au Limelight Montréal","DJ Pierre Jutras","limelight"],
    ["21:00","22:00","DJ OSKANA Show mix européen","DJ OSKANA","special"],
    ["22:00","24:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
  ],
};
const DAY_NAMES = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];

/* -----------------------------------------------------
   2. Helpers
   ----------------------------------------------------- */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

const store = {
  get(k, fallback = null) {
    try { const v = localStorage.getItem(k); return v === null ? fallback : v; }
    catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem(k, String(v)); } catch { /* noop */ } },
  getJSON(k, fallback) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  setJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* noop */ } },
};

function getMontrealParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE, hour12: false,
    weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    day: weekdayMap[parts.weekday] ?? 0,
    hour: parseInt(parts.hour, 10) % 24,
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
  };
}

function toMinutes(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }

function getCurrentSlot(date = new Date()) {
  const { day, hour, minute } = getMontrealParts(date);
  const nowMin = hour * 60 + minute;
  for (const [from, to, title, host, tag] of (SCHEDULE[day] || [])) {
    const fromMin = toMinutes(from);
    const toMin = to === "24:00" ? 24 * 60 : toMinutes(to);
    if (nowMin >= fromMin && nowMin < toMin) {
      return { from, to: to === "24:00" ? "00:00" : to, title, host, tag, day };
    }
  }
  return { from: "00:00", to: "07:00", title: "Hit Radio en continu", host: "Programmation", tag: "hitlist", day };
}

/* -----------------------------------------------------
   3. Pochette dynamique (SVG fallback) + iTunes
   ----------------------------------------------------- */
function fallbackCoverDataUri(slot) {
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

// Phase 3 — fetch avec timeout (AbortController) pour éviter de pendre sur réseau lent
function fetchWithTimeout(url, opts = {}, ms = 6000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

const coverCache = new Map();
async function fetchCover(artist, title) {
  const key = `${artist}|${title}`.toLowerCase();
  if (coverCache.has(key)) return coverCache.get(key);
  try {
    const term = encodeURIComponent(`${artist} ${title}`.trim());
    const r = await fetchWithTimeout(ITUNES_SEARCH + term, { mode: "cors" }, 5000);
    if (!r.ok) throw new Error("itunes http " + r.status);
    const data = await r.json();
    const hit = data?.results?.[0];
    const url = hit?.artworkUrl100?.replace("100x100", "300x300") || null;
    coverCache.set(key, url);
    return url;
  } catch { coverCache.set(key, null); return null; }
}

/* -----------------------------------------------------
   4. Now playing — best effort + historique
   ----------------------------------------------------- */
let lastTrackKey = "";
async function fetchNowPlaying() {
  for (const url of NOWPLAYING_ENDPOINTS) {
    try {
      const r = await fetchWithTimeout(url, { mode: "cors", cache: "no-store" }, 6000);
      if (!r.ok) continue;
      const ct = r.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const data = await r.json();
        const t = data?.data?.current_track || data?.track || data?.now_playing || data?.current || data;
        const title = t?.title || t?.song || t?.now_playing_title || t?.track || "";
        const artist = t?.artist || t?.now_playing_artist || "";
        if (title) return parseTrackString(String(title), String(artist || ""));
      } else {
        const txt = (await r.text()).trim();
        // CentovaCast nowplaying.php : "Hits Dance Music Stream - ARTIST - TITLE"
        if (txt && !txt.includes("<") && txt.includes(" - ")) {
          return parseTrackString(txt);
        }
        // SHOUTcast 7.html : CSV "listeners,status,peak,max,unique,bitrate,SONG"
        const csv = txt.replace(/<[^>]+>/g, "").trim();
        const cols = csv.split(",");
        if (cols.length >= 7) {
          const song = cols.slice(6).join(",").trim();
          if (song) return parseTrackString(song);
        }
      }
    } catch { /* CORS / réseau */ }
  }
  return null;
}

// Parse "Stream Name - Artist - Title" ou "Artist - Title" ou juste "Title"
function parseTrackString(s, knownArtist = "") {
  let str = (s || "").trim();
  if (!str) return null;
  // Coupe le prefix "Hits Dance Music Stream - " s'il existe
  str = str.replace(/^Hits?\s+Dance\s+Music\s+Stream\s*[-—|]\s*/i, "").trim();
  // Coupe les caracteres d'encodage type "?" entre titres
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

function getHistory() { return store.getJSON(STORAGE.history, []); }
function pushHistory(track, coverUrl) {
  if (!track || !track.title) return;
  const key = `${track.artist}|${track.title}`.toLowerCase();
  if (key === lastTrackKey) return;
  lastTrackKey = key;
  const list = getHistory();
  list.unshift({ artist: track.artist, title: track.title, cover: coverUrl || null, at: Date.now() });
  store.setJSON(STORAGE.history, list.slice(0, 12));
  renderHistory();
}

/* -----------------------------------------------------
   5. Player core (audio singleton + UI sync)
   ----------------------------------------------------- */
let audio = null;
const playerUIs = new Set();   // collection des UI à synchroniser
let currentSlot = null;
let currentTrack = null;
let currentCover = null;

function ensureAudio() {
  audio = $("#radioPlayer");
  if (!audio) {
    audio = document.createElement("audio");
    audio.id = "radioPlayer";
    audio.preload = "none";
    const src = document.createElement("source");
    src.src = STREAM_URL;
    src.type = "audio/mpeg";
    audio.appendChild(src);
    document.body.appendChild(audio);
  }
  return audio;
}

function applyVolumeFromStore() {
  if (!audio) return;
  const vol = parseFloat(store.get(STORAGE.vol, "0.85")) || 0.85;
  const muted = store.get(STORAGE.mute, "0") === "1";
  audio.volume = vol;
  audio.muted = muted;
  for (const ui of playerUIs) ui.syncVolume(vol, muted);
}

function setVolume(v, persist = true) {
  if (!audio) return;
  const clamped = Math.max(0, Math.min(1, v));
  audio.volume = clamped;
  if (clamped > 0) audio.muted = false;
  if (persist) store.set(STORAGE.vol, clamped);
  for (const ui of playerUIs) ui.syncVolume(clamped, audio.muted);
}

function toggleMute() {
  if (!audio) return;
  audio.muted = !audio.muted;
  store.set(STORAGE.mute, audio.muted ? "1" : "0");
  for (const ui of playerUIs) ui.syncVolume(audio.volume, audio.muted);
}

function setPlayingUI(isPlaying, label) {
  for (const ui of playerUIs) ui.setState(isPlaying, label);
  document.body.classList.toggle("is-playing-radio", isPlaying);
  // Phase 1 : expose un état lisible pour le CSS (live / buffering / offline / paused)
  let state = "idle";
  const l = (label || "").toLowerCase();
  if (isPlaying) state = "live";
  else if (l.includes("tampon") || l.includes("connexion")) state = "buffering";
  else if (l.includes("indisponible") || l.includes("bloquée") || l.includes("bloquee")) state = "offline";
  else if (l.includes("pause")) state = "paused";
  document.body.dataset.playerState = state;
  const vinyl = $("#vinylDisc");
  if (vinyl) vinyl.classList.toggle("is-spinning", isPlaying);
  if (typeof syncWatch === "function") syncWatch();
}

// Wake Lock : empêche l'écran de s'éteindre pendant la lecture
let _wakeLock = null;
async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request("screen");
    _wakeLock.addEventListener?.("release", () => { _wakeLock = null; });
  } catch { /* ignoré (batterie faible / HTTP) */ }
}
async function releaseWakeLock() {
  try { await _wakeLock?.release(); } catch { /* noop */ }
  _wakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && audio && !audio.paused && !_wakeLock) void requestWakeLock();
});

// Vibration tactile (mobile uniquement, ignoré sinon)
function haptic(pattern = 12) {
  try { navigator.vibrate?.(pattern); } catch { /* noop */ }
}

// Compteur de temps d'écoute de la session courante
let _sessionStartedAt = 0;
let _sessionAccumSec = 0;
let _sessionTickId = 0;
function sessionElapsedSec() {
  const live = _sessionStartedAt ? Math.floor((Date.now() - _sessionStartedAt) / 1000) : 0;
  return _sessionAccumSec + live;
}
function formatSessionShort(sec) {
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h}h${String(m).padStart(2,"0")}`;
}
function renderSessionBadge() {
  const txt = `Tu écoutes depuis ${formatSessionShort(sessionElapsedSec())}`;
  const a = document.getElementById("sessionBadgeMini");
  const b = document.getElementById("sessionBadgeFull");
  const visible = _sessionStartedAt > 0 || _sessionAccumSec > 0;
  if (a) { a.textContent = txt; a.hidden = !visible; }
  if (b) { b.textContent = txt; b.hidden = !visible; }
}
function startSessionClock() {
  if (_sessionStartedAt) return;
  _sessionStartedAt = Date.now();
  if (!_sessionTickId) _sessionTickId = window.setInterval(renderSessionBadge, 30_000);
  renderSessionBadge();
}
function pauseSessionClock() {
  if (!_sessionStartedAt) return;
  _sessionAccumSec += Math.floor((Date.now() - _sessionStartedAt) / 1000);
  _sessionStartedAt = 0;
  renderSessionBadge();
}

async function startPlayback() {
  ensureAudio();
  if (!audio) return;
  if (!audio.paused) return;
  try {
    setPlayingUI(false, "Connexion au direct…");
    audio.src = `${STREAM_URL}?_=${Date.now()}`;
    audio.load();
    await audio.play();
    setPlayingUI(true, "En direct");
    store.set(STORAGE.playing, "1");
    store.set(STORAGE.resume, "1");
    void requestWakeLock();
    startSessionClock();
  } catch (err) {
    console.warn("[HitRadio] play error", err);
    setPlayingUI(false, "Lecture bloquée — clique à nouveau");
    toast("Lecture bloquée par le navigateur. Clique sur ▶ pour démarrer.", "warn");
  }
}

function pausePlayback() {
  if (!audio) return;
  audio.pause();
  setPlayingUI(false, "En pause");
  store.set(STORAGE.playing, "0");
  void releaseWakeLock();
  pauseSessionClock();
}

async function togglePlayback() {
  ensureAudio();
  if (!audio) return;
  haptic(12);
  if (!audio.paused) pausePlayback();
  else await startPlayback();
}

function bindAudioEvents() {
  if (!audio || audio.dataset.bound === "1") return;
  audio.dataset.bound = "1";
  audio.addEventListener("waiting", () => setPlayingUI(false, "Mise en mémoire tampon…"));
  audio.addEventListener("playing", () => setPlayingUI(true, "En direct"));
  audio.addEventListener("pause", () => setPlayingUI(false, "En pause"));
  audio.addEventListener("error", () => {
    setPlayingUI(false, "Flux indisponible — réessaie");
    toast("Flux indisponible. Nouvel essai dans 5 s.", "error");
    if (store.get(STORAGE.playing, "0") === "1") {
      setTimeout(() => { void startPlayback(); }, 5000);
    }
  });
  audio.addEventListener("volumechange", () => {
    for (const ui of playerUIs) ui.syncVolume(audio.volume, audio.muted);
  });
}

/* -----------------------------------------------------
   6. UI : panneau complet (#player) + mini-player injecté
   ----------------------------------------------------- */
function makeFullPanelUI() {
  const panel = $("#player");
  if (!panel) return null;
  const playBtn = $("#playToggle", panel);
  const status = $("#playerStatus", panel);
  const vol = $("#volumeControl", panel);
  const cover = $("#onAirCover", panel);
  const titleEl = $("#onAirTitle", panel);
  const hostEl = $("#onAirHost", panel);
  const slotEl = $("#onAirSlot", panel);
  const tagEl = $("#onAirTag", panel);
  const trackLine = $("#liveTrackLine", panel);
  const trackText = $("#liveTrackText", panel);

  // Bouton mute injecté à côté du volume
  let muteBtn = $("#muteToggle", panel);
  if (!muteBtn && vol) {
    muteBtn = document.createElement("button");
    muteBtn.type = "button";
    muteBtn.id = "muteToggle";
    muteBtn.className = "icon-btn mute-btn";
    muteBtn.setAttribute("aria-label", "Couper le son");
    muteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
    vol.parentElement?.insertBefore(muteBtn, vol.parentElement.firstChild);
    muteBtn.addEventListener("click", toggleMute);
  }

  playBtn?.addEventListener("click", (e) => { e.preventDefault(); void togglePlayback(); });
  vol?.addEventListener("input", (e) => setVolume(Number(e.target.value)));

  return {
    syncVolume(v, muted) {
      if (vol) {
        vol.value = String(v);
        vol.style.setProperty("--vol-fill", `${Math.round((muted ? 0 : v) * 100)}%`);
      }
      muteBtn?.classList.toggle("is-muted", muted);
      muteBtn?.setAttribute("aria-label", muted ? "Activer le son" : "Couper le son");
    },
    setState(isPlaying, label) {
      if (playBtn) {
        playBtn.classList.toggle("is-playing", isPlaying);
        playBtn.setAttribute("aria-label", isPlaying ? "Mettre la radio en pause" : "Lancer la radio");
        playBtn.dataset.state = isPlaying ? "playing" : "paused";
      }
      if (status && label) status.textContent = label;
      panel.classList.toggle("is-playing", isPlaying);
      // Phase 1 : skeleton shimmer sur la pochette quand on charge
      if (cover) {
        const loading = !isPlaying && /tampon|connexion/i.test(label || "");
        cover.classList.toggle("is-loading", loading);
      }
    },
    syncSlot(slot) {
      const tag = SLOT_TAGS[slot.tag] || SLOT_TAGS.hitlist;
      if (titleEl) titleEl.textContent = slot.title;
      if (hostEl) hostEl.textContent = slot.host;
      if (slotEl) slotEl.textContent = `${slot.from} – ${slot.to}`;
      if (tagEl) {
        tagEl.textContent = tag.label;
        tagEl.style.setProperty("--tag-color", tag.color);
      }
      if (cover && !cover.dataset.live) {
        cover.src = fallbackCoverDataUri(slot);
        cover.alt = `Pochette — ${slot.title}`;
      }
    },
    syncTrack(track, coverUrl) {
      if (!trackLine || !trackText) return;
      if (!track) {
        trackLine.hidden = true;
        if (cover) delete cover.dataset.live;
        if (currentSlot) this.syncSlot(currentSlot);
        return;
      }
      trackLine.hidden = false;
      trackText.textContent = track.artist ? `${track.artist} — ${track.title}` : track.title;
      if (cover && coverUrl) {
        cover.dataset.live = "1";
        cover.src = coverUrl;
        cover.alt = `Pochette — ${track.title}`;
      }
    },
  };
}

function makeMiniPlayerUI() {
  // Ne pas dupliquer si déjà présent
  if ($("#miniPlayer")) return null;

  const bar = document.createElement("aside");
  bar.id = "miniPlayer";
  bar.className = "mini-player";
  bar.setAttribute("aria-label", "Lecteur radio Hit Radio");
  bar.innerHTML = `
    <button class="mini-play" id="miniPlay" type="button" aria-label="Lancer la radio" data-state="paused">
      <span class="mini-play-icon" aria-hidden="true"></span>
    </button>
    <div class="mini-meta">
      <span class="mini-show" id="miniShow">Hit Radio</span>
      <span class="mini-track" id="miniTrack">Les Hits Dance Music</span>
      <span class="mini-session" id="sessionBadgeMini" hidden></span>
    </div>
    <div class="mini-controls">
      <button class="mini-icon-btn" id="miniMute" type="button" aria-label="Couper le son" title="Muet (M)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
      </button>
      <input class="mini-volume" id="miniVolume" type="range" min="0" max="1" step="0.01" value="0.85" aria-label="Volume" />
      <button class="mini-icon-btn" id="miniHistoryBtn" type="button" aria-label="Historique des morceaux" title="Historique (H)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>
      </button>
      <button class="mini-icon-btn" id="miniShareBtn" type="button" aria-label="Partager" title="Partager">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
      </button>
      <button class="mini-icon-btn mini-close" id="miniClose" type="button" aria-label="Masquer le lecteur" title="Masquer">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
      </button>
    </div>`;
  document.body.appendChild(bar);

  const playBtn = $("#miniPlay", bar);
  const showEl = $("#miniShow", bar);
  const trackEl = $("#miniTrack", bar);
  const muteBtn = $("#miniMute", bar);
  const volEl = $("#miniVolume", bar);
  const histBtn = $("#miniHistoryBtn", bar);
  const shareBtn = $("#miniShareBtn", bar);
  const closeBtn = $("#miniClose", bar);

  playBtn.addEventListener("click", () => void togglePlayback());
  muteBtn.addEventListener("click", toggleMute);
  volEl.addEventListener("input", (e) => setVolume(Number(e.target.value)));
  histBtn.addEventListener("click", () => toggleHistory());
  shareBtn.addEventListener("click", () => shareCurrent());
  closeBtn.addEventListener("click", () => {
    bar.classList.add("is-hidden");
    sessionStorage.setItem("hr.miniHidden", "1");
  });

  // Sur l'accueil, le mini-player ne s'affiche que quand le grand player sort de l'écran
  const fullPanel = $("#player");
  if (fullPanel) {
    bar.classList.add("auto-hide");
    const io = new IntersectionObserver(
      ([entry]) => {
        bar.classList.toggle("is-shown", !entry.isIntersecting);
      },
      { threshold: 0.05 }
    );
    io.observe(fullPanel);
  } else {
    // Sur sous-pages : visible d'office (sauf masqué par l'utilisateur cette session)
    if (sessionStorage.getItem("hr.miniHidden") !== "1") bar.classList.add("is-shown");
  }

  return {
    syncVolume(v, muted) {
      volEl.value = String(v);
      volEl.style.setProperty("--vol-fill", `${Math.round((muted ? 0 : v) * 100)}%`);
      muteBtn.classList.toggle("is-muted", muted);
      muteBtn.setAttribute("aria-label", muted ? "Activer le son" : "Couper le son");
    },
    setState(isPlaying, label) {
      playBtn.classList.toggle("is-playing", isPlaying);
      playBtn.dataset.state = isPlaying ? "playing" : "paused";
      playBtn.setAttribute("aria-label", isPlaying ? "Mettre la radio en pause" : "Lancer la radio");
      bar.classList.toggle("is-loading", label === "Mise en mémoire tampon…" || label === "Connexion au direct…");
    },
    syncSlot(slot) {
      showEl.textContent = slot.title;
      if (!currentTrack) trackEl.textContent = slot.host || "Programmation";
    },
    syncTrack(track) {
      if (!track) return;
      trackEl.textContent = track.artist ? `${track.artist} — ${track.title}` : track.title;
    },
  };
}

/* -----------------------------------------------------
   7. Horloge + slot + live track
   ----------------------------------------------------- */
function renderClock() {
  const el = $("#playerClock");
  if (!el) return;
  const { hour, minute } = getMontrealParts();
  el.textContent = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} Québec`;
}

function renderOnAir() {
  currentSlot = getCurrentSlot();
  for (const ui of playerUIs) ui.syncSlot(currentSlot);
  highlightCurrentSlot();
  updateMediaSession();
  return currentSlot;
}

let nowPlayingFails = 0;
async function refreshLiveTrack() {
  if (document.hidden) return; // pause polling quand l'onglet est caché
  const np = await fetchNowPlaying();
  if (!np || !np.title) {
    nowPlayingFails++;
    if (nowPlayingFails === 3) {
      // Ne pas spammer ; juste un message discret la 1re fois
      const trackHint = $("#liveTrackHint");
      if (!trackHint) {
        const hint = document.createElement("p");
        hint.id = "liveTrackHint";
        hint.className = "live-track-hint";
        hint.textContent = "Métadonnées morceau indisponibles depuis ce navigateur.";
        $("#player .player-onair-info")?.appendChild(hint);
      }
    }
    currentTrack = null;
    for (const ui of playerUIs) ui.syncTrack(null);
    return;
  }
  nowPlayingFails = 0;
  currentTrack = np;
  let coverUrl = null;
  if (np.artist) coverUrl = await fetchCover(np.artist, np.title);
  currentCover = coverUrl;
  for (const ui of playerUIs) ui.syncTrack(np, coverUrl);
  pushHistory(np, coverUrl);
  updateMediaSession();
  // Phase 4 — a11y : annonce du nouveau morceau via région live
  announceTrack(np);
}

// Phase 4 — région ARIA live cachée pour les lecteurs d'écran
let _trackAnnouncer = null;
let _lastAnnouncedKey = "";
function announceTrack(np) {
  if (!np || !np.title) return;
  const key = `${np.artist || ""}|${np.title}`;
  if (key === _lastAnnouncedKey) return;
  _lastAnnouncedKey = key;
  if (!_trackAnnouncer) {
    _trackAnnouncer = document.createElement("div");
    _trackAnnouncer.className = "sr-only";
    _trackAnnouncer.setAttribute("role", "status");
    _trackAnnouncer.setAttribute("aria-live", "polite");
    _trackAnnouncer.setAttribute("aria-atomic", "true");
    document.body.appendChild(_trackAnnouncer);
  }
  _trackAnnouncer.textContent = np.artist
    ? `Maintenant : ${np.title} par ${np.artist}`
    : `Maintenant : ${np.title}`;
}

/* -----------------------------------------------------
   8. MediaSession
   ----------------------------------------------------- */
function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const slot = currentSlot || getCurrentSlot();
  const title = currentTrack ? (currentTrack.title || "Hit Radio") : (slot.title || "Hit Radio");
  const artist = currentTrack ? (currentTrack.artist || slot.host || "Hit Radio") : (slot.host || "Programmation");
  const artworkSrc = currentCover || fallbackCoverDataUri(slot);
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title, artist, album: "Hit Radio — Les Hits Dance Music",
      artwork: [
        { src: artworkSrc, sizes: "300x300", type: artworkSrc.startsWith("data:") ? "image/svg+xml" : "image/jpeg" },
      ],
    });
    navigator.mediaSession.setActionHandler("play", () => void startPlayback());
    navigator.mediaSession.setActionHandler("pause", () => pausePlayback());
    navigator.mediaSession.setActionHandler("stop", () => pausePlayback());
  } catch { /* noop */ }
}

/* -----------------------------------------------------
   9. Historique drawer + partage
   ----------------------------------------------------- */
function ensureHistoryDrawer() {
  let d = $("#historyDrawer");
  if (d) return d;
  d = document.createElement("aside");
  d.id = "historyDrawer";
  d.className = "history-drawer";
  d.setAttribute("aria-label", "Historique des morceaux diffusés");
  d.hidden = true;
  d.innerHTML = `
    <header class="history-head">
      <strong>Derniers morceaux</strong>
      <button type="button" class="icon-btn" id="historyClose" aria-label="Fermer l'historique">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
      </button>
    </header>
    <ol class="history-list" id="historyList"></ol>
    <p class="history-empty" id="historyEmpty">Aucun morceau encore détecté pendant cette session.</p>`;
  document.body.appendChild(d);
  $("#historyClose", d).addEventListener("click", () => toggleHistory(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !d.hidden) toggleHistory(false);
  });
  return d;
}

function toggleHistory(force) {
  const d = ensureHistoryDrawer();
  const open = typeof force === "boolean" ? force : d.hidden;
  d.hidden = !open;
  d.classList.toggle("is-open", open);
  if (open) renderHistory();
}

function renderHistory() {
  const d = ensureHistoryDrawer();
  const list = $("#historyList", d);
  const empty = $("#historyEmpty", d);
  const items = getHistory();
  if (!items.length) {
    list.innerHTML = ""; empty.hidden = false; return;
  }
  empty.hidden = true;
  list.innerHTML = items.map((it) => {
    const time = new Date(it.at).toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });
    const cover = it.cover ? `<img src="${it.cover}" alt="" loading="lazy" decoding="async" width="44" height="44" />` : `<span class="history-cover-fallback" aria-hidden="true">♪</span>`;
    const label = it.artist ? `${escapeHtml(it.artist)} — ${escapeHtml(it.title)}` : escapeHtml(it.title);
    const search = encodeURIComponent(`${it.artist || ""} ${it.title}`.trim());
    return `<li>
      <div class="history-cover">${cover}</div>
      <div class="history-meta">
        <strong>${label}</strong>
        <span>${time}</span>
      </div>
      <a class="history-search" href="https://music.youtube.com/search?q=${search}" target="_blank" rel="noopener" aria-label="Chercher sur YouTube Music">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </a>
    </li>`;
  }).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}

async function shareCurrent() {
  haptic([8, 30, 8]);
  const slot = currentSlot || getCurrentSlot();
  const trackText = currentTrack
    ? (currentTrack.artist ? `${currentTrack.artist} — ${currentTrack.title}` : currentTrack.title)
    : slot.title;
  const text = `J'écoute « ${trackText} » sur Hit Radio — Les Hits Dance Music`;
  const url = `${location.origin}${location.pathname}?play=1#player`;
  if (navigator.share) {
    try { await navigator.share({ title: "Hit Radio", text, url }); return; }
    catch { /* annulé */ }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast("Lien copié dans le presse-papiers !", "ok");
  } catch {
    toast("Partage non supporté sur ce navigateur.", "warn");
  }
}

/* -----------------------------------------------------
  10. Toasts
   ----------------------------------------------------- */
function ensureToastHost() {
  let h = $("#toastHost");
  if (h) return h;
  h = document.createElement("div");
  h.id = "toastHost";
  h.className = "toast-host";
  h.setAttribute("role", "status");
  h.setAttribute("aria-live", "polite");
  document.body.appendChild(h);
  return h;
}
function toast(msg, kind = "info", ms = 3500) {
  const host = ensureToastHost();
  const t = document.createElement("div");
  t.className = `toast toast--${kind}`;
  t.textContent = msg;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("is-shown"));
  setTimeout(() => {
    t.classList.remove("is-shown");
    setTimeout(() => t.remove(), 350);
  }, ms);
}

/* -----------------------------------------------------
  11. Horaire interactif (slot.is-now + auto-open jour)
   ----------------------------------------------------- */
function highlightCurrentSlot() {
  const blocks = $$(".day-block");
  if (!blocks.length || !currentSlot) return;
  // Mapping : index DOM 0 = Lundi (day 1), 6 = Dimanche (day 0)
  const domIndexForDay = { 1:0, 2:1, 3:2, 4:3, 5:4, 6:5, 0:6 };
  const todayBlockIdx = domIndexForDay[currentSlot.day];
  blocks.forEach((b, i) => {
    const isToday = i === todayBlockIdx;
    b.classList.toggle("is-today", isToday);
    if (isToday && !b.dataset.userToggled) b.open = true;
    b.addEventListener("toggle", () => { b.dataset.userToggled = "1"; }, { once: true });
  });
  const todayBlock = blocks[todayBlockIdx];
  if (!todayBlock) return;
  $$("li", todayBlock).forEach((li) => li.classList.remove("is-now"));
  const items = $$(".slot-list li", todayBlock);
  for (const li of items) {
    const time = $(".slot-time", li)?.textContent?.trim() || "";
    if (time.startsWith(currentSlot.from)) {
      li.classList.add("is-now");
      if (!$(".now-badge", li)) {
        const b = document.createElement("span");
        b.className = "now-badge";
        b.innerHTML = `<span class="now-dot" aria-hidden="true"></span>ON AIR`;
        li.appendChild(b);
      }
      break;
    }
  }
}

/* -----------------------------------------------------
  12. Raccourcis clavier (Espace, ↑↓, M, H)
   ----------------------------------------------------- */
function bindShortcuts() {
  document.addEventListener("keydown", (e) => {
    const tag = (e.target?.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag) || e.target?.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case " ":
      case "k":
        e.preventDefault(); void togglePlayback(); break;
      case "ArrowUp":
        e.preventDefault(); setVolume((audio?.volume ?? 0.85) + 0.05); break;
      case "ArrowDown":
        e.preventDefault(); setVolume((audio?.volume ?? 0.85) - 0.05); break;
      case "m":
      case "M":
        e.preventDefault(); toggleMute(); break;
      case "h":
      case "H":
        e.preventDefault(); toggleHistory(); break;
      default: break;
    }
  });
}

/* -----------------------------------------------------
  13. Burger nav + scroll + active section (inchangé)
   ----------------------------------------------------- */
function bindNav() {
  const header = $(".site-header");
  const navToggle = $("#navToggle");
  const primaryNav = $("#primary-nav");

  function setNavOpen(open) {
    if (!header || !navToggle || !primaryNav) return;
    header.classList.toggle("is-open", open);
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    navToggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
    document.body.style.overflow = open ? "hidden" : "";
  }

  if (navToggle && header && primaryNav) {
    navToggle.addEventListener("click", () => setNavOpen(!header.classList.contains("is-open")));
    primaryNav.querySelectorAll("a").forEach((link) =>
      link.addEventListener("click", () => setNavOpen(false))
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && header.classList.contains("is-open")) {
        setNavOpen(false); navToggle.focus();
      }
      // Focus trap dans le menu mobile ouvert
      if (e.key === "Tab" && header.classList.contains("is-open")) {
        const focusables = primaryNav.querySelectorAll('a, button, [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!primaryNav.contains(document.activeElement) && document.activeElement !== navToggle) {
          e.preventDefault(); first.focus();
        }
      }
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 900 && header.classList.contains("is-open")) setNavOpen(false);
    });
  }

  const updateScrolled = () => document.body.classList.toggle("is-scrolled", window.scrollY > 20);
  let scrollTicking = false;
  window.addEventListener("scroll", () => {
    if (scrollTicking) return;
    requestAnimationFrame(() => { updateScrolled(); scrollTicking = false; });
    scrollTicking = true;
  }, { passive: true });
  updateScrolled();

  const navSectionIds = ["animateurs", "horaire", "emissions", "contact"];
  const navSectionLinks = navSectionIds
    .map((id) => document.querySelector(`#primary-nav a[href="#${id}"]`))
    .filter(Boolean);
  const navSections = navSectionIds.map((id) => document.getElementById(id)).filter(Boolean);

  if (navSectionLinks.length && navSections.length >= 2) {
    const navObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        navSectionLinks.forEach((link) => {
          link.classList.toggle("is-active", link.getAttribute("href") === `#${id}`);
        });
      });
    }, { rootMargin: "-42% 0px -42% 0px", threshold: 0 });
    navSections.forEach((s) => navObserver.observe(s));
  }

  const staggerTargets = $$(".talent-card, .quick-strip-card");
  if (staggerTargets.length) {
    staggerTargets.forEach((el) => el.classList.add("stagger-ready"));
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    staggerTargets.forEach((el) => revealObserver.observe(el));
  }
}

/* -----------------------------------------------------
  14. Service Worker (PWA)
   ----------------------------------------------------- */
function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW", err));
  });
}

/* -----------------------------------------------------
  15. Page Contact : autocomplete iTunes pour demande de titre
   ----------------------------------------------------- */
function bindContactForm() {
  const form = $("#contactForm");
  if (!form) return;
  const trackInput = $("#trackQuery", form);
  const suggestList = $("#trackSuggest", form);
  let timer = 0;

  trackInput?.addEventListener("input", () => {
    clearTimeout(timer);
    const q = trackInput.value.trim();
    if (q.length < 3) { suggestList.innerHTML = ""; suggestList.hidden = true; return; }
    timer = window.setTimeout(async () => {
      try {
        const r = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=5&term=${encodeURIComponent(q)}`);
        const data = await r.json();
        const items = (data?.results || []).map((x) => `${x.artistName} — ${x.trackName}`);
        if (!items.length) { suggestList.hidden = true; return; }
        suggestList.innerHTML = items.map((t) => `<li role="option">${escapeHtml(t)}</li>`).join("");
        suggestList.hidden = false;
      } catch { suggestList.hidden = true; }
    }, 280);
  });
  suggestList?.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    trackInput.value = li.textContent || "";
    suggestList.hidden = true;
  });

  form.addEventListener("submit", (e) => {
    // Honeypot
    const honey = $("#hp_field", form);
    if (honey && honey.value) { e.preventDefault(); return; }
    if (!form.checkValidity()) { e.preventDefault(); form.reportValidity(); return; }
    // Construit un mailto enrichi
    e.preventDefault();
    const fd = new FormData(form);
    const sujet = fd.get("sujet") || "Message Hit Radio";
    const body = [
      `Nom : ${fd.get("nom") || ""}`,
      `Email : ${fd.get("email") || ""}`,
      `Sujet : ${sujet}`,
      `Demande de titre : ${fd.get("track") || "—"}`,
      "",
      String(fd.get("message") || ""),
    ].join("\n");
    const to = form.dataset.mail || "studio@hit.radio";
    location.href = `mailto:${to}?subject=${encodeURIComponent("[Hit Radio] " + sujet)}&body=${encodeURIComponent(body)}`;
    toast("Ouverture de ton client email…", "ok");
  });
}

/* -----------------------------------------------------
  16. Page Horaire : génération + .ics
   ----------------------------------------------------- */
function buildScheduleTable() {
  const host = $("#scheduleFull");
  if (!host) return;
  const today = getMontrealParts().day;
  const order = [1,2,3,4,5,6,0];
  host.innerHTML = order.map((d) => {
    const slots = SCHEDULE[d] || [];
    const isToday = d === today;
    return `<details class="day-block${isToday ? " is-today" : ""}"${isToday ? " open" : ""}>
      <summary>${DAY_NAMES[d]}${isToday ? " · aujourd'hui" : ""}</summary>
      <ul class="slot-list">
        ${slots.map(([from, to, title, host, tag]) => `
          <li class="slot--${tag}">
            <span class="slot-time">${from}–${to === "24:00" ? "00:00" : to}</span>
            <span class="slot-title">${escapeHtml(title)}</span>
            <span class="slot-host">${escapeHtml(host)}</span>
          </li>`).join("")}
      </ul>
    </details>`;
  }).join("");
}

function downloadIcs() {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Hit Radio//Schedule//FR", "CALSCALE:GREGORIAN",
  ];
  const order = [1,2,3,4,5,6,0]; // commence lundi
  // Référence : prochain lundi à partir d'aujourd'hui
  const today = new Date();
  const dow = today.getDay(); // 0..6 (dim=0)
  const offsetToMonday = (dow === 0 ? 1 : (8 - dow) % 7 || 7);
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (offsetToMonday === 7 ? 0 : offsetToMonday));
  function fmt(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
  }
  order.forEach((dayKey, dayIdx) => {
    const base = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + dayIdx);
    for (const [from, to, title, host] of (SCHEDULE[dayKey] || [])) {
      const [fh, fm] = from.split(":").map(Number);
      const [th, tm] = (to === "24:00" ? "24:00" : to).split(":").map(Number);
      const start = new Date(base); start.setHours(fh, fm, 0, 0);
      const end = new Date(base);
      if (th === 24) { end.setDate(end.getDate() + 1); end.setHours(0, tm, 0, 0); }
      else end.setHours(th, tm, 0, 0);
      lines.push("BEGIN:VEVENT",
        `UID:${start.getTime()}-${dayKey}-hitradio@local`,
        `DTSTART;TZID=America/Toronto:${fmt(start)}`,
        `DTEND;TZID=America/Toronto:${fmt(end)}`,
        `SUMMARY:${title.replace(/[\r\n,;]/g, " ")}`,
        `DESCRIPTION:${(host || "").replace(/[\r\n,;]/g, " ")} — Hit Radio`,
        "RRULE:FREQ=WEEKLY",
        "END:VEVENT");
    }
  });
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "hit-radio-grille-2026.ics";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast("Fichier .ics téléchargé — importe-le dans ton agenda.", "ok");
}

/* -----------------------------------------------------
  17. Sleep timer
   ----------------------------------------------------- */
let sleepTimerId = 0;
let sleepEndsAt = 0;
let sleepTickId = 0;

function startSleepTimer(minutes) {
  cancelSleepTimer(true);
  if (!minutes || minutes <= 0) return;
  sleepEndsAt = Date.now() + minutes * 60_000;
  sleepTimerId = window.setTimeout(() => {
    pausePlayback();
    toast("Minuteur écoulé — radio en pause. Bonne nuit ! 🌙", "ok", 5000);
    cancelSleepTimer(true);
  }, minutes * 60_000);
  sleepTickId = window.setInterval(updateSleepBadge, 1000);
  updateSleepBadge();
  toast(`Minuteur réglé : ${minutes} min`, "ok");
}
function cancelSleepTimer(silent = false) {
  if (sleepTimerId) clearTimeout(sleepTimerId);
  if (sleepTickId) clearInterval(sleepTickId);
  sleepTimerId = 0; sleepEndsAt = 0; sleepTickId = 0;
  updateSleepBadge();
  if (!silent) toast("Minuteur annulé", "info");
}
function updateSleepBadge() {
  const badge = $("#sleepBadge");
  if (!badge) return;
  if (!sleepEndsAt) { badge.hidden = true; return; }
  badge.hidden = false;
  const left = Math.max(0, sleepEndsAt - Date.now());
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  badge.textContent = `🌙 ${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function ensureSleepMenu() {
  if ($("#sleepMenu")) return;
  const wrap = document.createElement("div");
  wrap.id = "sleepMenu";
  wrap.className = "sleep-menu";
  wrap.hidden = true;
  wrap.setAttribute("role", "menu");
  wrap.innerHTML = `
    <button type="button" data-min="15" role="menuitem">15 min</button>
    <button type="button" data-min="30" role="menuitem">30 min</button>
    <button type="button" data-min="45" role="menuitem">45 min</button>
    <button type="button" data-min="60" role="menuitem">1 h</button>
    <button type="button" data-min="90" role="menuitem">1 h 30</button>
    <button type="button" data-min="120" role="menuitem">2 h</button>
    <button type="button" data-min="0" role="menuitem" class="sleep-cancel">Annuler</button>`;
  document.body.appendChild(wrap);
  wrap.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const min = Number(b.dataset.min);
    if (min === 0) cancelSleepTimer();
    else startSleepTimer(min);
    wrap.hidden = true;
  });
  document.addEventListener("click", (e) => {
    if (wrap.hidden) return;
    if (e.target.closest("#sleepBtn") || e.target.closest("#sleepMenu") || e.target.closest("#mi_sleepBtn")) return;
    wrap.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !wrap.hidden) wrap.hidden = true;
  });
}
function toggleSleepMenu(anchor) {
  ensureSleepMenu();
  const menu = $("#sleepMenu");
  if (menu.hidden) {
    const r = anchor.getBoundingClientRect();
    // Si l'ancre est masquée (rect 0), centre sous le bouton ⋯ ou en haut à droite
    let top = r.bottom + 8;
    let left = Math.max(8, Math.min(window.innerWidth - 200, r.left));
    if (r.width === 0 && r.height === 0) {
      const more = document.querySelector("#moreBtn");
      if (more) {
        const mr = more.getBoundingClientRect();
        top = mr.bottom + 8;
        left = Math.max(8, mr.right - 180);
      } else {
        top = 64; left = window.innerWidth - 200;
      }
    }
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.hidden = false;
  } else {
    menu.hidden = true;
  }
}

/* -----------------------------------------------------
  18. Bouton install PWA
   ----------------------------------------------------- */
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  $$("#installPwaBtn, .install-pwa-btn").forEach((b) => b.classList.add("is-available"));
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  $$("#installPwaBtn, .install-pwa-btn").forEach((b) => b.classList.remove("is-available"));
  toast("Hit Radio installé sur ton appareil ! 🎉", "ok");
});
async function triggerInstall() {
  if (!deferredInstallPrompt) {
    toast("Installation déjà effectuée ou non supportée.", "info");
    return;
  }
  deferredInstallPrompt.prompt();
  try { await deferredInstallPrompt.userChoice; } catch { /* noop */ }
  deferredInstallPrompt = null;
}

/* -----------------------------------------------------
  19. Theme : auto / dark / light
   ----------------------------------------------------- */
const THEME_KEY = "hr.theme";
function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === "light") root.dataset.theme = "light";
  else if (mode === "dark") root.dataset.theme = "dark";
  else delete root.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = (root.dataset.theme === "light") ? "#fafafa" : "#0f0f12";
  $$(".theme-toggle").forEach((b) => {
    b.dataset.theme = mode;
    b.setAttribute("aria-label", `Thème : ${mode === "light" ? "clair" : mode === "dark" ? "sombre" : "auto"}`);
  });
}
function cycleTheme() {
  const cur = store.get(THEME_KEY, "auto");
  const next = cur === "auto" ? "dark" : cur === "dark" ? "light" : "auto";
  store.set(THEME_KEY, next);
  applyTheme(next);
}

/* -----------------------------------------------------
  20. Recherche globale (Ctrl+K) — palette
   ----------------------------------------------------- */
const SEARCH_INDEX = [
  // Pages
  { type: "page", label: "Accueil", url: "index.html" },
  { type: "page", label: "DJs & animateurs", url: "animateurs.html" },
  { type: "page", label: "Émissions", url: "emissions.html" },
  { type: "page", label: "Horaire complet 2026", url: "horaire.html" },
  { type: "page", label: "Contact studio", url: "contact.html" },
  // Animateurs
  { type: "team", label: "Alain Perron — Les matins d'Alain", url: "animateurs.html" },
  { type: "team", label: "DJ Pierre Jutras — Hommage Limelight", url: "animateurs.html" },
  { type: "team", label: "DJ Jumpoff — Mix club", url: "animateurs.html" },
  { type: "team", label: "DJ OSKANA — Show mix européen", url: "animateurs.html" },
  { type: "team", label: "Pee Jee — Pee Jee Radio Show", url: "animateurs.html" },
  // Shows
  { type: "show", label: "Les matins d'Alain (live)", url: "emissions.html" },
  { type: "show", label: "Hit List", url: "emissions.html" },
  { type: "show", label: "Le Hit Drive (live)", url: "emissions.html" },
  { type: "show", label: "Hommage au Limelight Montréal", url: "emissions.html" },
  { type: "show", label: "Nuits Best DJ's BeatRadioWorld", url: "emissions.html" },
  { type: "show", label: "Disco Fever Experience", url: "emissions.html" },
  { type: "show", label: "Latino Show", url: "emissions.html" },
  { type: "show", label: "Hot Slow Show", url: "emissions.html" },
  { type: "show", label: "Pee Jee Radio Show", url: "emissions.html" },
  { type: "show", label: "DJ OSKANA Show mix européen", url: "emissions.html" },
  // Actions
  { type: "action", label: "▶ Écouter le direct", action: () => startPlayback() },
  { type: "action", label: "⏸ Mettre en pause", action: () => pausePlayback() },
  { type: "action", label: "🔇 Couper le son", action: () => toggleMute() },
  { type: "action", label: "🌙 Minuteur de sommeil", action: () => toggleSleepMenu(document.body) },
  { type: "action", label: "🎵 Historique des morceaux", action: () => toggleHistory(true) },
  { type: "action", label: "📅 Télécharger la grille (.ics)", action: () => downloadIcs() },
  { type: "action", label: "🔗 Partager le direct", action: () => shareCurrent() },
  { type: "action", label: "🎨 Changer de thème", action: () => cycleTheme() },
  { type: "action", label: "📲 Installer l'app", action: () => triggerInstall() },
  { type: "action", label: "🎚 Ouvrir l'égaliseur", action: () => toggleEqPanel() },
  { type: "action", label: "🔔 Activer/désactiver notifications", action: () => toggleShowNotifications() },
  { type: "action", label: "📊 Voir mes statistiques d'écoute", action: () => location.href = "stats.html" },
  { type: "action", label: "💾 Exporter l'historique (JSON)", action: () => exportHistory("json") },
  { type: "action", label: "💾 Exporter l'historique (CSV)", action: () => exportHistory("csv") },
  { type: "page", label: "Statistiques d'écoute", url: "stats.html" },
];
const TYPE_LABEL = { page: "Page", team: "Équipe", show: "Émission", action: "Action" };

function ensureSearchPalette() {
  if ($("#searchPalette")) return;
  const wrap = document.createElement("div");
  wrap.id = "searchPalette";
  wrap.className = "search-palette";
  wrap.hidden = true;
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("aria-label", "Recherche rapide");
  wrap.innerHTML = `
    <div class="search-backdrop" id="searchBackdrop"></div>
    <div class="search-box">
      <div class="search-input-wrap">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="searchInput" type="search" placeholder="Cherche un show, un DJ, une action…" autocomplete="off" />
        <kbd>Esc</kbd>
      </div>
      <ul id="searchResults" class="search-results" role="listbox"></ul>
      <p class="search-hint">↑↓ pour naviguer · ⏎ pour ouvrir · Ctrl+K pour rouvrir</p>
    </div>`;
  document.body.appendChild(wrap);
  const input = $("#searchInput", wrap);
  const list = $("#searchResults", wrap);
  $("#searchBackdrop", wrap).addEventListener("click", () => closeSearch());
  input.addEventListener("input", () => renderSearchResults(input.value));
  let activeIdx = 0;
  input.addEventListener("keydown", (e) => {
    const items = $$("li", list);
    if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = Math.min(items.length - 1, activeIdx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); }
    else if (e.key === "Enter") { e.preventDefault(); items[activeIdx]?.click(); return; }
    else if (e.key === "Escape") { closeSearch(); return; }
    items.forEach((it, i) => it.classList.toggle("is-active", i === activeIdx));
    items[activeIdx]?.scrollIntoView({ block: "nearest" });
  });
  list.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-idx]");
    if (!li) return;
    const item = SEARCH_INDEX[Number(li.dataset.idx)];
    closeSearch();
    if (item.action) item.action();
    else if (item.url) location.href = item.url;
  });
}
function renderSearchResults(q) {
  const list = $("#searchResults");
  if (!list) return;
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const query = norm(q.trim());
  const items = !query
    ? SEARCH_INDEX
    : SEARCH_INDEX.filter((it) => norm(it.label).includes(query));
  list.innerHTML = items.slice(0, 12).map((it) => {
    const idx = SEARCH_INDEX.indexOf(it);
    return `<li role="option" data-idx="${idx}" tabindex="-1">
      <span class="search-type search-type--${it.type}">${TYPE_LABEL[it.type]}</span>
      <span class="search-label">${escapeHtml(it.label)}</span>
    </li>`;
  }).join("") || `<li class="search-empty">Aucun résultat pour « ${escapeHtml(q)} »</li>`;
  list.firstElementChild?.classList.add("is-active");
}
function openSearch() {
  ensureSearchPalette();
  const p = $("#searchPalette");
  p.hidden = false;
  requestAnimationFrame(() => p.classList.add("is-open"));
  const input = $("#searchInput");
  input.value = "";
  renderSearchResults("");
  setTimeout(() => input.focus(), 50);
}
function closeSearch() {
  const p = $("#searchPalette");
  if (!p || p.hidden) return;
  p.classList.remove("is-open");
  setTimeout(() => { p.hidden = true; }, 200);
}

/* -----------------------------------------------------
  21. Visualiseur audio (Web Audio API)
   ----------------------------------------------------- */
let audioCtx = null;
let analyser = null;
let visualRAF = 0;

function setupVisualizer() {
  const canvas = $("#vizCanvas");
  if (!canvas || !audio) return;
  if (audioCtx) return;
  // Le flux SHOUTcast n'envoie pas de headers CORS : connecter Web Audio rendrait
  // toute la sortie audio muette ("MediaElementAudioSource outputs zeroes").
  // On préfère garder le son. Le visualizer reste vide (canvas masqué).
  if (canvas) canvas.hidden = true;
}
function drawVisualizer() {
  const canvas = $("#vizCanvas");
  if (!canvas || !analyser) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
  };
  resize();
  window.addEventListener("resize", resize);
  const buffer = new Uint8Array(analyser.frequencyBinCount);
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#c8102e";
  function tick() {
    visualRAF = requestAnimationFrame(tick);
    if (audio.paused) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    analyser.getByteFrequencyData(buffer);
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const bars = buffer.length;
    const barW = w / bars;
    for (let i = 0; i < bars; i++) {
      const v = buffer[i] / 255;
      const bh = v * h * 0.95;
      const grad = ctx.createLinearGradient(0, h - bh, 0, h);
      grad.addColorStop(0, accent);
      grad.addColorStop(1, "rgba(220,20,48,0.05)");
      ctx.fillStyle = grad;
      const x = i * barW;
      ctx.fillRect(x + barW * 0.15, h - bh, barW * 0.7, bh);
    }
  }
  tick();
}

/* -----------------------------------------------------
  22. Countdown vers le prochain show
   ----------------------------------------------------- */
function getNextSlot(date = new Date()) {
  const { day, hour, minute } = getMontrealParts(date);
  const nowMin = hour * 60 + minute;
  const slots = SCHEDULE[day] || [];
  for (const [from, to, title, host, tag] of slots) {
    const fromMin = toMinutes(from);
    if (fromMin > nowMin) {
      return { from, to, title, host, tag, sameDay: true, day };
    }
  }
  // Sinon : premier slot du jour suivant
  const nextDay = (day + 1) % 7;
  const nextSlots = SCHEDULE[nextDay] || [];
  if (nextSlots.length) {
    const [from, to, title, host, tag] = nextSlots[0];
    return { from, to, title, host, tag, sameDay: false, day: nextDay };
  }
  return null;
}
function renderCountdown() {
  const el = $("#nextShowCountdown");
  if (!el) return;
  const next = getNextSlot();
  if (!next) { el.hidden = true; return; }
  el.hidden = false;
  const { hour, minute } = getMontrealParts();
  const nowMin = hour * 60 + minute;
  const fromMin = toMinutes(next.from);
  let mins = next.sameDay ? (fromMin - nowMin) : ((24 * 60 - nowMin) + fromMin);
  if (mins < 0) mins = 0;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const when = h > 0 ? `${h} h ${String(m).padStart(2,"0")}` : `${m} min`;
  el.innerHTML = `<span class="countdown-kicker">Prochain :</span> <strong>${escapeHtml(next.title)}</strong> <span class="countdown-time">dans ${when}${next.sameDay ? "" : " (demain)"}</span>`;
}

/* -----------------------------------------------------
  23. Online / offline + page offline
   ----------------------------------------------------- */
function bindConnectivity() {
  function update() {
    const offline = !navigator.onLine;
    document.body.classList.toggle("is-offline", offline);
    let banner = $("#offlineBanner");
    if (offline) {
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "offlineBanner";
        banner.className = "offline-banner";
        banner.textContent = "📡 Hors ligne — la lecture du flux nécessite une connexion.";
        document.body.appendChild(banner);
      }
      banner.classList.add("is-shown");
    } else if (banner) {
      banner.classList.remove("is-shown");
    }
  }
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

/* -----------------------------------------------------
  24. JSON-LD RadioStation (SEO)
   ----------------------------------------------------- */
function injectJsonLd() {
  if ($("#hr-jsonld")) return;
  const data = {
    "@context": "https://schema.org",
    "@type": "RadioStation",
    "name": "Hit Radio — Les Hits Dance Music",
    "url": location.origin + "/",
    "logo": location.origin + "/assets/favicon.svg",
    "broadcastDisplayName": "Hit Radio",
    "broadcastTimezone": "America/Toronto",
    "inLanguage": "fr-CA",
    "genre": ["Dance", "House", "Hits"],
    "telephone": "+1-418-261-2886",
    "potentialAction": {
      "@type": "ListenAction",
      "target": STREAM_URL,
    },
  };
  const s = document.createElement("script");
  s.type = "application/ld+json";
  s.id = "hr-jsonld";
  s.textContent = JSON.stringify(data);
  document.head.appendChild(s);
}

/* -----------------------------------------------------
  25. Page animateurs : prochaine diffusion par DJ
   ----------------------------------------------------- */
function annotateTalentCards() {
  const cards = $$(".talent-card");
  if (!cards.length) return;
  cards.forEach((card) => {
    const name = card.querySelector("p")?.textContent?.trim() || "";
    if (!name) return;
    const next = findNextSlotForHost(name);
    if (!next) return;
    if (card.querySelector(".talent-next")) return;
    const tag = SLOT_TAGS[next.tag] || SLOT_TAGS.hitlist;
    const el = document.createElement("p");
    el.className = "talent-next";
    el.innerHTML = `<span class="talent-next-dot" style="background:${tag.color}"></span>Prochain : <strong>${DAY_NAMES[next.day]} ${next.from}</strong> — ${escapeHtml(next.title)}`;
    card.appendChild(el);
  });
}
function findNextSlotForHost(hostName) {
  const norm = (s) => (s || "").toLowerCase();
  const target = norm(hostName);
  const { day, hour, minute } = getMontrealParts();
  const nowMin = hour * 60 + minute;
  for (let off = 0; off < 7; off++) {
    const d = (day + off) % 7;
    const slots = SCHEDULE[d] || [];
    for (const [from, to, title, host, tag] of slots) {
      if (!norm(host).includes(target.split(" ")[0]) && !norm(title).includes(target.split(" ")[0])) continue;
      const fromMin = toMinutes(from);
      if (off > 0 || fromMin > nowMin) {
        return { from, to, title, host, tag, day: d };
      }
    }
  }
  return null;
}

/* -----------------------------------------------------
  26. Header tools : injecte sleep/install/theme/search
   ----------------------------------------------------- */
function injectHeaderTools() {
  const header = $(".site-header");
  if (!header) return;
  if ($("#headerTools")) return;
  const tools = document.createElement("div");
  tools.id = "headerTools";
  tools.className = "header-tools";
  tools.innerHTML = `
    <span id="sleepBadge" class="sleep-badge" hidden></span>
    <button type="button" id="searchBtn" class="header-tool" aria-label="Recherche (Ctrl+K)" title="Recherche (Ctrl+K)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    </button>
    <button type="button" id="sleepBtn" class="header-tool" aria-label="Minuteur de sommeil" title="Minuteur (sleep)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    </button>
    <button type="button" id="themeBtn" class="header-tool theme-toggle" aria-label="Changer de thème" title="Thème">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    </button>
    <button type="button" id="installPwaBtn" class="header-tool install-pwa-btn" aria-label="Installer l'app" title="Installer">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    </button>`;
  header.appendChild(tools);
  $("#searchBtn").addEventListener("click", openSearch);
  $("#sleepBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleSleepMenu(e.currentTarget); });
  $("#themeBtn").addEventListener("click", cycleTheme);
  $("#installPwaBtn").addEventListener("click", triggerInstall);
}

/* -----------------------------------------------------
  27. Favoris animateurs / shows
   ----------------------------------------------------- */
function getFavs() { return new Set(store.getJSON(STORAGE.favs, [])); }
function setFavs(set) { store.setJSON(STORAGE.favs, [...set]); }
function isFav(key) { return getFavs().has(key); }
function toggleFav(key, label) {
  const favs = getFavs();
  if (favs.has(key)) { favs.delete(key); toast(`Retiré des favoris : ${label}`, "info"); }
  else { favs.add(key); toast(`Ajouté aux favoris : ${label} ♥`, "ok"); }
  setFavs(favs);
  syncFavButtons();
  applyFavFilter();
}
function syncFavButtons() {
  const favs = getFavs();
  $$(".fav-btn").forEach((b) => {
    const on = favs.has(b.dataset.favKey);
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", on ? "Retirer des favoris" : "Ajouter aux favoris");
  });
}
function injectFavButtons() {
  // Cartes animateurs
  $$(".talent-card").forEach((card) => {
    if (card.querySelector(".fav-btn")) return;
    const name = card.querySelector("p")?.textContent?.trim();
    if (!name) return;
    const key = "talent:" + name.toLowerCase();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fav-btn";
    btn.dataset.favKey = key;
    btn.dataset.favLabel = name;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
    btn.addEventListener("click", (e) => { e.stopPropagation(); toggleFav(key, name); });
    card.appendChild(btn);
  });
  // Cartes shows (.show-detail)
  $$(".show-detail").forEach((card) => {
    if (card.querySelector(".fav-btn")) return;
    const title = card.querySelector("h3")?.textContent?.trim();
    if (!title) return;
    const key = "show:" + title.toLowerCase();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fav-btn";
    btn.dataset.favKey = key;
    btn.dataset.favLabel = title;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
    btn.addEventListener("click", (e) => { e.stopPropagation(); toggleFav(key, title); });
    card.appendChild(btn);
  });
  syncFavButtons();
}
function injectFavFilter() {
  const containers = $$(".talent-grid, .show-detail-grid");
  containers.forEach((grid) => {
    const parent = grid.parentElement;
    if (!parent || parent.querySelector(".fav-filter-bar")) return;
    const bar = document.createElement("div");
    bar.className = "fav-filter-bar";
    bar.innerHTML = `
      <button type="button" class="fav-filter is-active" data-filter="all">Tout afficher</button>
      <button type="button" class="fav-filter" data-filter="favs">♥ Mes favoris <span class="fav-count" data-fav-count></span></button>`;
    parent.insertBefore(bar, grid);
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-filter]");
      if (!b) return;
      $$(".fav-filter", bar).forEach((x) => x.classList.toggle("is-active", x === b));
      grid.dataset.filter = b.dataset.filter;
      applyFavFilter();
    });
  });
  applyFavFilter();
}
function applyFavFilter() {
  const favs = getFavs();
  $$("[data-fav-count]").forEach((el) => { el.textContent = favs.size ? `(${favs.size})` : ""; });
  $$(".talent-grid, .show-detail-grid").forEach((grid) => {
    const mode = grid.dataset.filter || "all";
    $$(".talent-card, .show-detail", grid).forEach((card) => {
      const key = card.querySelector(".fav-btn")?.dataset.favKey;
      const show = mode === "all" || (key && favs.has(key));
      card.style.display = show ? "" : "none";
    });
  });
}

/* -----------------------------------------------------
  28. Notifications navigateur (changement de show)
   ----------------------------------------------------- */
async function ensureNotifPermission(silent = false) {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  if (silent) return false;
  const res = await Notification.requestPermission();
  return res === "granted";
}
function notifyShowChange(slot) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return; // pas de doublon avec toast in-page
  const tag = SLOT_TAGS[slot.tag] || SLOT_TAGS.hitlist;
  try {
    new Notification(`Maintenant sur Hit Radio : ${slot.title}`, {
      body: `${slot.from}–${slot.to} · ${slot.host || tag.label}`,
      icon: "assets/favicon.svg",
      tag: "hr-show",
      silent: true,
    });
  } catch { /* noop */ }
}
function checkSlotChange() {
  const slot = getCurrentSlot();
  if (!slot) return;
  const sig = `${slot.from}|${slot.title}`;
  const last = store.get(STORAGE.notifLastSlot, "");
  if (sig === last) return;
  store.set(STORAGE.notifLastSlot, sig);
  if (!last) return; // premier passage : pas de notif
  if (store.get(STORAGE.notifShow, "0") === "1") notifyShowChange(slot);
  // toast in-page peu importe
  toast(`🎙 Place à : ${slot.title}`, "info", 5000);
}
function bindNotifToggle() {
  // Bouton dans header tools : on ajoute via header ; ici juste l'activation depuis search palette/action
}
async function toggleShowNotifications() {
  const cur = store.get(STORAGE.notifShow, "0") === "1";
  if (cur) {
    store.set(STORAGE.notifShow, "0");
    toast("Notifications de show désactivées", "info");
    return;
  }
  const ok = await ensureNotifPermission();
  if (!ok) { toast("Permission refusée par le navigateur.", "warn"); return; }
  store.set(STORAGE.notifShow, "1");
  toast("Notifications de show activées 🔔", "ok");
}

/* -----------------------------------------------------
  29. Égaliseur 3 bandes (Web Audio BiquadFilter)
   ----------------------------------------------------- */
let eqNodes = null; // { bass, mid, treble }
function setupEq() {
  if (!audioCtx || !analyser || eqNodes) return;
  // Insère bass→mid→treble entre la source et l'analyser
  // Note : on a déjà src→analyser→dest. Pour ré-insérer proprement,
  // on ajoute simplement les filtres entre analyser et destination.
  try {
    const bass = audioCtx.createBiquadFilter(); bass.type = "lowshelf"; bass.frequency.value = 200;
    const mid = audioCtx.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 1;
    const treble = audioCtx.createBiquadFilter(); treble.type = "highshelf"; treble.frequency.value = 3200;
    analyser.disconnect();
    analyser.connect(bass);
    bass.connect(mid);
    mid.connect(treble);
    treble.connect(audioCtx.destination);
    eqNodes = { bass, mid, treble };
    // Restaure le dernier preset
    const saved = store.getJSON(STORAGE.eq, { bass: 0, mid: 0, treble: 0 });
    setEqGain("bass", saved.bass);
    setEqGain("mid", saved.mid);
    setEqGain("treble", saved.treble);
  } catch (err) { console.warn("[HitRadio] eq", err); }
}
function setEqGain(band, dB) {
  if (!eqNodes || !eqNodes[band]) return;
  const v = Math.max(-12, Math.min(12, Number(dB) || 0));
  eqNodes[band].gain.value = v;
  const cur = store.getJSON(STORAGE.eq, { bass: 0, mid: 0, treble: 0 });
  cur[band] = v;
  store.setJSON(STORAGE.eq, cur);
  const slider = $(`#eq-${band}`);
  const out = $(`#eq-${band}-val`);
  if (slider && Number(slider.value) !== v) slider.value = v;
  if (out) out.textContent = `${v > 0 ? "+" : ""}${v} dB`;
}
function ensureEqPanel() {
  if ($("#eqPanel")) return;
  const wrap = document.createElement("div");
  wrap.id = "eqPanel";
  wrap.className = "eq-panel";
  wrap.hidden = true;
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-label", "Égaliseur");
  const saved = store.getJSON(STORAGE.eq, { bass: 0, mid: 0, treble: 0 });
  wrap.innerHTML = `
    <header class="eq-head">
      <strong>Égaliseur</strong>
      <button type="button" class="eq-close" aria-label="Fermer">×</button>
    </header>
    <div class="eq-body">
      ${["bass","mid","treble"].map((b) => {
        const labels = { bass: "Graves", mid: "Médiums", treble: "Aigus" };
        return `<label class="eq-row">
          <span>${labels[b]}</span>
          <input id="eq-${b}" type="range" min="-12" max="12" step="1" value="${saved[b]}" />
          <output id="eq-${b}-val">${saved[b] > 0 ? "+" : ""}${saved[b]} dB</output>
        </label>`;
      }).join("")}
      <div class="eq-presets">
        <button type="button" data-preset="flat">Flat</button>
        <button type="button" data-preset="bass">Bass+</button>
        <button type="button" data-preset="vocal">Vocal</button>
        <button type="button" data-preset="club">Club</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector(".eq-close").addEventListener("click", () => { wrap.hidden = true; });
  ["bass","mid","treble"].forEach((b) => {
    wrap.querySelector(`#eq-${b}`).addEventListener("input", (e) => setEqGain(b, e.target.value));
  });
  wrap.querySelectorAll(".eq-presets button").forEach((b) => {
    b.addEventListener("click", () => {
      const p = b.dataset.preset;
      const map = { flat: [0,0,0], bass: [6,0,2], vocal: [-2,4,1], club: [5,-1,4] };
      const [bs, mi, tr] = map[p] || [0,0,0];
      setEqGain("bass", bs); setEqGain("mid", mi); setEqGain("treble", tr);
    });
  });
  document.addEventListener("click", (e) => {
    if (wrap.hidden) return;
    if (e.target.closest("#eqPanel") || e.target.closest("#eqBtn")) return;
    wrap.hidden = true;
  });
}
function toggleEqPanel() {
  if (!audioCtx) {
    toast("Lance la lecture d'abord pour activer l'égaliseur.", "info");
    return;
  }
  setupEq();
  ensureEqPanel();
  const p = $("#eqPanel");
  p.hidden = !p.hidden;
}

/* -----------------------------------------------------
  30. Statistiques d'écoute locale
   ----------------------------------------------------- */
const stats = {
  load() {
    return store.getJSON(STORAGE.stats, {
      totalSec: 0,
      sessions: 0,
      perShow: {},     // title -> seconds
      perDay: {},      // YYYY-MM-DD -> seconds
      firstSession: null,
      lastSession: null,
    });
  },
  save(s) { store.setJSON(STORAGE.stats, s); },
  reset() {
    store.setJSON(STORAGE.stats, {
      totalSec: 0, sessions: 0, perShow: {}, perDay: {}, firstSession: null, lastSession: null,
    });
  },
};
let statsTickId = 0;
let statsLastTick = 0;
function startStatsTracking() {
  if (statsTickId) return;
  const s = stats.load();
  s.sessions += 1;
  if (!s.firstSession) s.firstSession = new Date().toISOString();
  s.lastSession = new Date().toISOString();
  stats.save(s);
  statsLastTick = Date.now();
  statsTickId = window.setInterval(() => {
    if (audio?.paused || audio?.muted) { statsLastTick = Date.now(); return; }
    const now = Date.now();
    const delta = Math.min(30, Math.floor((now - statsLastTick) / 1000));
    if (delta <= 0) return;
    statsLastTick = now;
    const cur = stats.load();
    cur.totalSec += delta;
    const slot = getCurrentSlot();
    if (slot) cur.perShow[slot.title] = (cur.perShow[slot.title] || 0) + delta;
    const dayKey = new Date().toISOString().slice(0, 10);
    cur.perDay[dayKey] = (cur.perDay[dayKey] || 0) + delta;
    cur.lastSession = new Date().toISOString();
    stats.save(cur);
  }, 5000);
}
function stopStatsTracking() {
  if (statsTickId) { clearInterval(statsTickId); statsTickId = 0; }
}
function formatDuration(sec) {
  if (sec < 60) return `${sec} s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2,"0")}`;
}
function renderStatsPage() {
  const root = $("#statsRoot");
  if (!root) return;
  const s = stats.load();
  const topShows = Object.entries(s.perShow).sort((a,b) => b[1] - a[1]).slice(0, 8);
  const topDays = Object.entries(s.perDay).sort((a,b) => b[0] < a[0] ? 1 : -1).slice(0, 14);
  const maxShow = topShows[0]?.[1] || 1;
  const maxDay = Math.max(...topDays.map(([,v]) => v), 1);
  root.innerHTML = `
    <div class="stats-summary">
      <div class="stat-card"><small>Temps total</small><strong>${formatDuration(s.totalSec)}</strong></div>
      <div class="stat-card"><small>Sessions</small><strong>${s.sessions}</strong></div>
      <div class="stat-card"><small>Premier passage</small><strong>${s.firstSession ? new Date(s.firstSession).toLocaleDateString("fr-CA") : "—"}</strong></div>
      <div class="stat-card"><small>Dernière écoute</small><strong>${s.lastSession ? new Date(s.lastSession).toLocaleDateString("fr-CA") : "—"}</strong></div>
    </div>
    <h2>Top émissions écoutées</h2>
    ${topShows.length ? `<ul class="stats-bars">${topShows.map(([t, v]) => `
      <li><span class="bar-label">${escapeHtml(t)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(v/maxShow*100).toFixed(1)}%"></span></span>
      <span class="bar-value">${formatDuration(v)}</span></li>`).join("")}</ul>` : `<p class="stats-empty">Aucune écoute enregistrée pour l'instant.</p>`}
    <h2>14 derniers jours</h2>
    ${topDays.length ? `<ul class="stats-bars stats-days">${topDays.map(([d, v]) => `
      <li><span class="bar-label">${d}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(v/maxDay*100).toFixed(1)}%"></span></span>
      <span class="bar-value">${formatDuration(v)}</span></li>`).join("")}</ul>` : ``}
    <div class="stats-actions">
      <button type="button" id="exportStats" class="btn btn-soft">Exporter (.json)</button>
      <button type="button" id="resetStats" class="btn btn-ghost">Réinitialiser</button>
    </div>`;
  $("#exportStats")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `hitradio-stats-${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  });
  $("#resetStats")?.addEventListener("click", () => {
    if (confirm("Réinitialiser toutes les statistiques ?")) {
      stats.reset(); renderStatsPage(); toast("Statistiques réinitialisées.", "info");
    }
  });
}

/* -----------------------------------------------------
  31. Recherche / export historique
   ----------------------------------------------------- */
function exportHistory(format = "json") {
  const items = store.getJSON(STORAGE.history, []);
  if (!items.length) { toast("Historique vide.", "info"); return; }
  let blob, name;
  if (format === "csv") {
    const header = "iso,artist,title\n";
    const rows = items.map((it) => `"${it.iso || ""}","${(it.artist || "").replace(/"/g,'""')}","${(it.title || "").replace(/"/g,'""')}"`).join("\n");
    blob = new Blob([header + rows], { type: "text/csv" });
    name = `hitradio-history-${Date.now()}.csv`;
  } else {
    blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    name = `hitradio-history-${Date.now()}.json`;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function injectHistorySearch() {
  const drawer = $("#historyDrawer");
  if (!drawer || drawer.querySelector(".history-search")) return;
  const head = drawer.querySelector(".history-head") || drawer.firstElementChild;
  const tools = document.createElement("div");
  tools.className = "history-search";
  tools.innerHTML = `
    <input type="search" id="historyFilter" placeholder="Filtrer (artiste, titre)…" />
    <button type="button" class="btn btn-ghost btn-xs" id="exportHistJson">JSON</button>
    <button type="button" class="btn btn-ghost btn-xs" id="exportHistCsv">CSV</button>`;
  head.insertAdjacentElement("afterend", tools);
  $("#historyFilter").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    $$("#historyDrawer li").forEach((li) => {
      li.style.display = !q || li.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  });
  $("#exportHistJson").addEventListener("click", () => exportHistory("json"));
  $("#exportHistCsv").addEventListener("click", () => exportHistory("csv"));
}

/* -----------------------------------------------------
  32. Deep links : ?show=slug ouvre un show sur emissions.html
   ----------------------------------------------------- */
function handleDeepLinks() {
  const params = new URLSearchParams(location.search);
  const slug = params.get("show");
  if (!slug) return;
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-");
  const cards = $$(".show-detail");
  for (const card of cards) {
    const title = card.querySelector("h3")?.textContent || "";
    if (norm(title) === slug || norm(title).includes(slug)) {
      card.classList.add("is-highlighted");
      requestAnimationFrame(() => card.scrollIntoView({ behavior: "smooth", block: "center" }));
      setTimeout(() => card.classList.remove("is-highlighted"), 4000);
      break;
    }
  }
}

/* -----------------------------------------------------
  33. Accessibilité : aria-live + focus trap
   ----------------------------------------------------- */
function ensureLiveRegion() {
  if ($("#hr-live")) return;
  const live = document.createElement("div");
  live.id = "hr-live";
  live.className = "sr-only";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  document.body.appendChild(live);
}
function announce(msg) {
  ensureLiveRegion();
  const live = $("#hr-live");
  live.textContent = "";
  setTimeout(() => { live.textContent = msg; }, 50);
}
function trapFocus(container) {
  if (!container) return () => {};
  const focusables = container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
  if (!focusables.length) return () => {};
  const first = focusables[0], last = focusables[focusables.length - 1];
  const handler = (e) => {
    if (e.key !== "Tab") return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  container.addEventListener("keydown", handler);
  return () => container.removeEventListener("keydown", handler);
}

/* -----------------------------------------------------
  34. Bouton EQ + notifs dans header tools (extension)
   ----------------------------------------------------- */
function injectExtraHeaderTools() {
  const tools = $("#headerTools");
  if (!tools || $("#eqBtn")) return;
  const eqBtn = document.createElement("button");
  eqBtn.type = "button";
  eqBtn.id = "eqBtn";
  eqBtn.className = "header-tool";
  eqBtn.title = "Égaliseur";
  eqBtn.setAttribute("aria-label", "Égaliseur");
  eqBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`;
  eqBtn.addEventListener("click", toggleEqPanel);
  tools.insertBefore(eqBtn, $("#installPwaBtn"));

  const notifBtn = document.createElement("button");
  notifBtn.type = "button";
  notifBtn.id = "notifBtn";
  notifBtn.className = "header-tool";
  notifBtn.title = "Notifications de show";
  notifBtn.setAttribute("aria-label", "Notifications de show");
  notifBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
  notifBtn.addEventListener("click", toggleShowNotifications);
  tools.insertBefore(notifBtn, $("#installPwaBtn"));

  // Reflète l'état activé
  if (store.get(STORAGE.notifShow, "0") === "1") notifBtn.classList.add("is-on");
}

/* -----------------------------------------------------
  35. Wave 4 — bandes scrollables (rails)
   ----------------------------------------------------- */
const WEBRADIOS = [
  { id: "main",    name: "Hit Radio Live", desc: "Le flux principal 24/7", color: "#c8102e", emoji: "📻", main: true },
  { id: "dance",   name: "Dance Floor",    desc: "100 % club & house",     color: "#ff3a6e", emoji: "💃" },
  { id: "disco",   name: "Disco Fever",    desc: "Le meilleur du disco",   color: "#e8b84b", emoji: "🪩" },
  { id: "latino",  name: "Latino Mix",     desc: "Reggaeton, salsa, urbano", color: "#ff8a3d", emoji: "🌶️" },
  { id: "slow",    name: "Hot Slow",       desc: "Slows et love songs",     color: "#7c44a8", emoji: "❤️" },
  { id: "remix",   name: "Hit Remix",      desc: "Tes tubes en versions remix", color: "#3da8ff", emoji: "🎚" },
  { id: "ibiza",   name: "Ibiza Sunset",   desc: "Vibes Balearic du coucher", color: "#ff6b8a", emoji: "🌅" },
  { id: "french",  name: "French Touch",   desc: "Daft, Justice, Cassius…", color: "#6ee7b7", emoji: "🇫🇷" },
];

const NEWS_ITEMS = [
  { tag: "DJ Set",  title: "DJ JÜMPOFF — JÜMPOFFproject", text: "Mix club et soirées énergie dance, plusieurs créneaux du mercredi au dimanche.", emoji: "🎚️" },
  { tag: "Antenne", title: "Hommage Limelight Montréal", text: "DJ Pierre Jutras revient cette semaine avec quatre créneaux signatures.", emoji: "🎙" },
  { tag: "Émission", title: "Nouvelle saison de Hit Drive", text: "Du lundi au vendredi 16h–18h, l'antenne accélère pour la sortie des bureaux.", emoji: "🚗" },
  { tag: "Nuit",    title: "BeatRadioWorld : Best DJ's internationaux", text: "Tous les soirs 22h–07h, mixes live d'Europe, Amérique, Asie.", emoji: "🌙" },
  { tag: "Studio",  title: "Alain Perron en matinale", text: "Café-actu-musique chaque matin 7h–9h. Appelle au 418-261-2886.", emoji: "☕" },
  { tag: "Mix",     title: "DJ OSKANA — Show européen", text: "Jeudi 21h et samedi 21h pour la house continentale.", emoji: "🎧" },
  { tag: "Latino",  title: "Latino Show samedi", text: "Reggaeton, urbano et latin house par les meilleurs DJs de Montréal.", emoji: "🌶️" },
  { tag: "Live",    title: "Ibiza — Le Chiwawa beach club", text: "Captations live des soirées Chiwawa : vibes balearic, house solaire et coucher de soleil.", emoji: "🌅" },
];

function rail(title, emoji, items, renderItem, opts = {}) {
  return `
    <div class="rail">
      <div class="rail-head">
        <h2><span aria-hidden="true">${emoji}</span> ${escapeHtml(title)}</h2>
        ${opts.cta ? `<a class="rail-cta" href="${opts.cta.href}">${escapeHtml(opts.cta.label)} →</a>` : ""}
        <div class="rail-arrows" role="group" aria-label="Faire défiler">
          <button type="button" class="rail-arrow" data-dir="-1" aria-label="Précédent">‹</button>
          <button type="button" class="rail-arrow" data-dir="1" aria-label="Suivant">›</button>
        </div>
      </div>
      <div class="rail-track" tabindex="0">
        ${items.map(renderItem).join("")}
      </div>
    </div>`;
}

function bindRailArrows() {
  $$(".rail").forEach((r) => {
    const track = $(".rail-track", r);
    if (!track) return;
    $$(".rail-arrow", r).forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = Number(btn.dataset.dir) || 1;
        track.scrollBy({ left: dir * Math.min(track.clientWidth * 0.85, 600), behavior: "smooth" });
      });
    });
  });
}

function renderRailUpcoming() {
  const root = $("#rail-upcoming");
  if (!root) return;
  // Construit 8 prochains créneaux
  const items = [];
  const { day, hour, minute } = getMontrealParts();
  const nowMin = hour * 60 + minute;
  let started = false;
  for (let off = 0; off < 7 && items.length < 8; off++) {
    const d = (day + off) % 7;
    const slots = SCHEDULE[d] || [];
    for (const [from, to, title, host, tag] of slots) {
      const fromMin = toMinutes(from);
      if (off === 0 && fromMin <= nowMin) continue;
      started = true;
      const minsAway = off * 24 * 60 + fromMin - (off === 0 ? nowMin : nowMin);
      const realDelta = off === 0 ? (fromMin - nowMin) : ((24 * 60 - nowMin) + (off - 1) * 24 * 60 + fromMin);
      items.push({ from, to, title, host, tag, day: d, when: realDelta });
      if (items.length >= 8) break;
    }
  }
  if (!items.length) return;
  root.hidden = false;
  root.innerHTML = rail("Prochaines émissions", "🕓", items, (it) => {
    const tag = SLOT_TAGS[it.tag] || SLOT_TAGS.hitlist;
    const h = Math.floor(it.when / 60);
    const m = it.when % 60;
    const when = h > 0 ? `dans ${h} h ${String(m).padStart(2,"0")}` : `dans ${m} min`;
    return `<article class="rail-card upcoming-card" style="--card-accent:${tag.color}">
      <span class="rail-tag">${escapeHtml(tag.label)}</span>
      <h3>${escapeHtml(it.title)}</h3>
      <p class="rail-meta">${DAY_NAMES[it.day]} · ${it.from}–${it.to}</p>
      <p class="rail-host">${escapeHtml(it.host || "Programmation")}</p>
      <p class="rail-when">${when}</p>
    </article>`;
  }, { cta: { href: "horaire.html", label: "Voir la grille" } });
}

function renderRailWebradios() {
  const root = $("#rail-webradios");
  if (!root) return;
  root.hidden = false;
  root.innerHTML = rail("Nos webradios", "🎵", WEBRADIOS, (w) => {
    return `<article class="rail-card webradio-card${w.main ? " is-main" : ""}" style="--card-accent:${w.color}" data-webradio="${w.id}">
      <span class="rail-emoji" aria-hidden="true">${w.emoji}</span>
      <h3>${escapeHtml(w.name)}</h3>
      <p class="rail-meta">${escapeHtml(w.desc)}</p>
      <button type="button" class="rail-play" data-webradio-play="${w.id}">▶ Écouter</button>
    </article>`;
  });
  $$("[data-webradio-play]").forEach((b) => {
    b.addEventListener("click", () => {
      const id = b.dataset.webradioPlay;
      const w = WEBRADIOS.find((x) => x.id === id);
      if (!w) return;
      // Toutes les "webradios" pointent vers le flux principal pour l'instant
      void startPlayback();
      toast(`▶ ${w.name}`, "ok");
    });
  });
}

function renderRailReplays() {
  const root = $("#rail-replays");
  if (!root) return;
  // On regroupe les shows par "type" — utilise SCHEDULE pour générer une liste unique
  const seen = new Set();
  const items = [];
  for (const day of Object.values(SCHEDULE)) {
    for (const [from, to, title, host, tag] of day) {
      if (seen.has(title)) continue;
      seen.add(title);
      items.push({ title, host, tag, sample: `${from}–${to}` });
      if (items.length >= 10) break;
    }
    if (items.length >= 10) break;
  }
  root.hidden = false;
  root.innerHTML = rail("Toutes les émissions", "🎙", items, (it) => {
    const tag = SLOT_TAGS[it.tag] || SLOT_TAGS.hitlist;
    const slug = it.title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-");
    return `<a class="rail-card replay-card" href="emissions.html?show=${slug}" style="--card-accent:${tag.color}">
      <span class="rail-tag">${escapeHtml(tag.label)}</span>
      <h3>${escapeHtml(it.title)}</h3>
      <p class="rail-meta">${escapeHtml(it.host || "Programmation")}</p>
      <p class="rail-when">Créneau type · ${it.sample}</p>
    </a>`;
  }, { cta: { href: "emissions.html", label: "Toutes les émissions" } });
}

function renderRailNews() {
  const root = $("#rail-news");
  if (!root) return;
  root.hidden = false;
  root.innerHTML = rail("À la une", "✨", NEWS_ITEMS, (it) => {
    return `<article class="rail-card news-card">
      <span class="rail-emoji" aria-hidden="true">${it.emoji}</span>
      <span class="rail-tag">${escapeHtml(it.tag)}</span>
      <h3>${escapeHtml(it.title)}</h3>
      <p class="rail-meta">${escapeHtml(it.text)}</p>
    </article>`;
  });
}

function renderAllRails() {
  renderRailUpcoming();
  renderRailWebradios();
  renderRailReplays();
  renderRailNews();
  bindRailArrows();
}

/* -----------------------------------------------------
  36. Météo Montréal (Open-Meteo, no key, CORS OK)
   ----------------------------------------------------- */
const WEATHER_CODES = {
  0: ["☀️", "Ciel clair"], 1: ["🌤", "Peu nuageux"], 2: ["⛅", "Partiellement nuageux"], 3: ["☁️", "Couvert"],
  45: ["🌫", "Brouillard"], 48: ["🌫", "Brouillard givrant"],
  51: ["🌦", "Bruine légère"], 53: ["🌦", "Bruine"], 55: ["🌧", "Bruine forte"],
  61: ["🌧", "Pluie faible"], 63: ["🌧", "Pluie"], 65: ["🌧", "Pluie forte"],
  71: ["🌨", "Neige faible"], 73: ["🌨", "Neige"], 75: ["❄️", "Neige forte"],
  80: ["🌦", "Averses"], 81: ["🌧", "Averses"], 82: ["⛈", "Averses violentes"],
  95: ["⛈", "Orage"], 96: ["⛈", "Orage grêle"], 99: ["⛈", "Orage violent"],
};
async function loadWeather() {
  const host = $("#mtlWeather");
  if (!host) return;
  try {
    const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=46.8139&longitude=-71.2080&current=temperature_2m,weather_code,wind_speed_10m&timezone=America%2FToronto", { cache: "no-store" });
    if (!res.ok) throw new Error("weather");
    const data = await res.json();
    const c = data.current || {};
    const [emoji, label] = WEATHER_CODES[c.weather_code] || ["🌡", "—"];
    host.hidden = false;
    host.innerHTML = `
      <span class="weather-emoji" aria-hidden="true">${emoji}</span>
      <span class="weather-temp">${Math.round(c.temperature_2m)}°</span>
      <span class="weather-meta"><strong>Québec</strong> · ${escapeHtml(label)}</span>`;
  } catch {
    host.hidden = true;
  }
}

/* -----------------------------------------------------
  37. Sticky bottom nav (mobile)
   ----------------------------------------------------- */
function injectBottomNav() {
  if ($("#bottomNav")) return;
  const nav = document.createElement("nav");
  nav.id = "bottomNav";
  nav.className = "bottom-nav";
  nav.setAttribute("aria-label", "Navigation rapide");
  const path = location.pathname.split("/").pop() || "index.html";
  const items = [
    { href: "index.html", label: "Accueil", icon: '<path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/>' },
    { href: "#player",    label: "Direct",  icon: '<polygon points="6 4 20 12 6 20 6 4"/>', action: "play" },
    { href: "horaire.html", label: "Grille", icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
    { href: "emissions.html", label: "Shows", icon: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>' },
    { href: "#more",      label: "Plus",    icon: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>', action: "more" },
  ];
  nav.innerHTML = items.map((it) => {
    const active = it.href === path || (it.href === "index.html" && (path === "" || path === "index.html"));
    return `<a class="bn-item${active ? " is-active" : ""}" href="${it.href}" data-action="${it.action || ""}">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${it.icon}</svg>
      <span>${it.label}</span>
    </a>`;
  }).join("");
  document.body.appendChild(nav);
  document.body.classList.add("has-bottom-nav");

  $$(".bn-item", nav).forEach((a) => {
    a.addEventListener("click", (e) => {
      const action = a.dataset.action;
      if (action === "play") {
        e.preventDefault();
        $("#player")?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (audio?.paused) void startPlayback();
      } else if (action === "more") {
        e.preventDefault();
        openSearch();
      }
    });
  });
}

/* -----------------------------------------------------
  38. Mode plein écran ("Watch")
   ----------------------------------------------------- */
function ensureWatchMode() {
  if ($("#watchMode")) return;
  const wm = document.createElement("div");
  wm.id = "watchMode";
  wm.className = "watch-mode";
  wm.hidden = true;
  wm.setAttribute("role", "dialog");
  wm.setAttribute("aria-label", "Lecteur plein écran");
  wm.innerHTML = `
    <div class="watch-backdrop" id="watchBackdrop" aria-hidden="true"></div>
    <div class="watch-blobs" aria-hidden="true">
      <span class="wb wb-1"></span><span class="wb wb-2"></span><span class="wb wb-3"></span>
    </div>
    <div class="watch-grain" aria-hidden="true"></div>
    <header class="watch-top">
      <div class="watch-brand">
        <span class="watch-live-dot"></span>
        <span class="watch-live-label">EN DIRECT</span>
        <span class="watch-clock" id="watchClock">--:--</span>
      </div>
      <div class="watch-top-actions">
        <button type="button" class="watch-icon" id="watchLyricsBtn" title="Paroles" aria-label="Paroles">🎤</button>
        <button type="button" class="watch-icon" id="watchPipBtn" title="Picture-in-Picture" aria-label="Picture-in-Picture">🗔</button>
        <button type="button" class="watch-icon watch-close" title="Fermer (Esc)" aria-label="Fermer">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
        </button>
      </div>
    </header>

    <div class="watch-stage">
      <div class="watch-vinyl" id="watchVinyl" aria-hidden="true">
        <div class="watch-cover" id="watchCover">
          <span class="watch-cover-mark">HR</span>
        </div>
        <div class="watch-vinyl-ring"></div>
      </div>
      <div class="watch-bars" id="watchBars" aria-hidden="true">
        ${Array.from({length: 24}, (_, i) => `<span style="--i:${i}"></span>`).join("")}
      </div>
      <div class="watch-info">
        <p class="watch-tag" id="watchTag">LIVE · Hit Radio</p>
        <h2 class="watch-title" id="watchTitle">En direct</h2>
        <p class="watch-host" id="watchHost">Programmation</p>
        <p class="watch-track" id="watchTrack" hidden></p>
      </div>
    </div>

    <div class="watch-controls">
      <button type="button" class="watch-btn watch-btn--small" id="watchMute" aria-label="Couper le son">🔊</button>
      <button type="button" class="watch-btn watch-btn--play" id="watchPlay" aria-label="Lecture/Pause">▶</button>
      <button type="button" class="watch-btn watch-btn--small" id="watchShare" aria-label="Partager">🔗</button>
    </div>

    <div class="watch-volume" role="group" aria-label="Volume">
      <span aria-hidden="true">🔈</span>
      <input type="range" id="watchVol" min="0" max="1" step="0.01" value="1" aria-label="Volume" />
      <span aria-hidden="true">🔊</span>
    </div>

    <div class="watch-reactions" id="watchReactions" aria-label="Réactions">
      ${["🔥","❤️","🎉","🕺","💯","🤘"].map(e => `<button type="button" class="watch-react" data-emoji="${e}" aria-label="${e}">${e}</button>`).join("")}
    </div>

    <footer class="watch-bottom">
      <div class="watch-next" id="watchNext" hidden>
        <span class="watch-next-label">À SUIVRE</span>
        <span class="watch-next-time" id="watchNextTime">--:--</span>
        <span class="watch-next-title" id="watchNextTitle">—</span>
      </div>
      <p class="watch-hint">Esc pour fermer · Espace pour play/pause · M pour mute</p>
    </footer>`;
  document.body.appendChild(wm);

  wm.querySelector(".watch-close").addEventListener("click", closeWatch);
  $("#watchPlay").addEventListener("click", () => {
    if (audio.paused) void startPlayback();
    else pausePlayback();
  });
  $("#watchMute").addEventListener("click", toggleMute);
  $("#watchShare").addEventListener("click", shareCurrent);
  $("#watchLyricsBtn").addEventListener("click", () => { try { toggleLyrics(); } catch {} });
  $("#watchPipBtn").addEventListener("click", () => { try { togglePip(); } catch {} });
  const vol = $("#watchVol");
  if (vol && audio) {
    vol.value = String(audio.volume ?? 1);
    vol.addEventListener("input", () => {
      audio.volume = Number(vol.value);
      try { store.set(STORAGE.vol, vol.value); } catch {}
    });
  }
  $("#watchReactions").addEventListener("click", (e) => {
    const btn = e.target.closest(".watch-react");
    if (!btn) return;
    try { floatEmoji(btn.dataset.emoji, btn); } catch {}
    btn.classList.add("is-pop");
    setTimeout(() => btn.classList.remove("is-pop"), 250);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !wm.hidden) closeWatch();
  });
}
let _watchClockTimer = 0;
function syncWatch() {
  const wm = $("#watchMode");
  if (!wm || wm.hidden) return;
  const slot = currentSlot || getCurrentSlot();
  $("#watchTitle").textContent = slot?.title || "En direct";
  $("#watchHost").textContent = slot?.host || "Programmation";
  const tag = SLOT_TAGS[slot?.tag] || SLOT_TAGS.hitlist;
  $("#watchTag").textContent = `LIVE · ${tag.label}`;
  $("#watchTag").style.color = tag.color;
  const trackEl = $("#watchTrack");
  if (currentTrack) { trackEl.textContent = `♫ ${currentTrack}`; trackEl.hidden = false; }
  else trackEl.hidden = true;
  const cover = $("#watchCover");
  const backdrop = $("#watchBackdrop");
  if (currentCover) {
    cover.style.backgroundImage = `url("${currentCover}")`;
    cover.classList.add("has-img");
    if (backdrop) backdrop.style.backgroundImage = `url("${currentCover}")`;
  } else {
    cover.style.backgroundImage = "";
    cover.classList.remove("has-img");
    if (backdrop) backdrop.style.backgroundImage = "";
  }
  const playBtn = $("#watchPlay");
  if (playBtn) {
    const playing = !audio?.paused;
    playBtn.textContent = playing ? "⏸" : "▶";
    wm.classList.toggle("is-playing", playing);
  }
  // Prochain show
  try {
    const next = (typeof getNextSlot === "function") ? getNextSlot() : null;
    const nextWrap = $("#watchNext");
    if (next && nextWrap) {
      $("#watchNextTime").textContent = next.start || "";
      $("#watchNextTitle").textContent = next.title || "";
      nextWrap.hidden = false;
    } else if (nextWrap) {
      nextWrap.hidden = true;
    }
  } catch {}
  // Horloge live
  const clock = $("#watchClock");
  if (clock) {
    const fmt = () => {
      const d = new Date();
      clock.textContent = d.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Toronto" });
    };
    fmt();
    if (!_watchClockTimer) _watchClockTimer = setInterval(fmt, 30000);
  }
}
function openWatch() {
  ensureWatchMode();
  const wm = $("#watchMode");
  wm.hidden = false;
  document.body.classList.add("watch-open");
  requestAnimationFrame(() => wm.classList.add("is-open"));
  syncWatch();
  setupWatchVisualizer();
}
function closeWatch() {
  const wm = $("#watchMode");
  if (!wm) return;
  wm.classList.remove("is-open");
  document.body.classList.remove("watch-open");
  if (_watchClockTimer) { clearInterval(_watchClockTimer); _watchClockTimer = 0; }
  setTimeout(() => { wm.hidden = true; cancelAnimationFrame(watchVizRAF); watchVizRAF = 0; }, 250);
}
let watchVizRAF = 0;
function setupWatchVisualizer() {
  const canvas = $("#watchViz");
  if (!canvas || !analyser) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
  };
  resize();
  window.addEventListener("resize", resize);
  const buffer = new Uint8Array(analyser.frequencyBinCount);
  function tick() {
    watchVizRAF = requestAnimationFrame(tick);
    if (audio.paused) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    analyser.getByteFrequencyData(buffer);
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const radius = Math.min(w, h) * 0.22;
    for (let i = 0; i < buffer.length; i++) {
      const v = buffer[i] / 255;
      const angle = (i / buffer.length) * Math.PI * 2;
      const len = v * radius * 1.6 + 4;
      const x1 = cx + Math.cos(angle) * radius;
      const y1 = cy + Math.sin(angle) * radius;
      const x2 = cx + Math.cos(angle) * (radius + len);
      const y2 = cy + Math.sin(angle) * (radius + len);
      ctx.strokeStyle = `hsla(${(i / buffer.length) * 30 + 340}, 90%, ${50 + v * 30}%, 0.85)`;
      ctx.lineWidth = 3 * dpr;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
  tick();
}
function injectWatchButton() {
  // Bouton plein écran à côté du clock dans le player
  const header = $(".player-header");
  if (!header || $("#watchOpenBtn")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "watchOpenBtn";
  btn.className = "watch-open-btn";
  btn.title = "Mode plein écran";
  btn.setAttribute("aria-label", "Ouvrir le lecteur plein écran");
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
  btn.addEventListener("click", openWatch);
  header.appendChild(btn);
}

/* -----------------------------------------------------
  39. Wave 5 — couleur dominante extraite de la pochette
   ----------------------------------------------------- */
let _coverColorCache = new Map();
function extractDominantColor(imgUrl) {
  return new Promise((resolve) => {
    if (!imgUrl) return resolve(null);
    if (_coverColorCache.has(imgUrl)) return resolve(_coverColorCache.get(imgUrl));
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        const size = 32;
        c.width = c.height = size;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        // Bucket par teinte la plus saturée
        const buckets = new Map();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 200) continue;
          // Ignore pixels trop sombres ou trop clairs
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const lum = (max + min) / 2;
          if (lum < 40 || lum > 230) continue;
          if (max - min < 30) continue; // trop gris
          const key = `${Math.round(r / 24)},${Math.round(g / 24)},${Math.round(b / 24)}`;
          const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
          e.r += r; e.g += g; e.b += b; e.n++;
          buckets.set(key, e);
        }
        let best = null, bestN = 0;
        for (const e of buckets.values()) if (e.n > bestN) { bestN = e.n; best = e; }
        if (!best) return resolve(null);
        const color = `rgb(${Math.round(best.r / best.n)}, ${Math.round(best.g / best.n)}, ${Math.round(best.b / best.n)})`;
        _coverColorCache.set(imgUrl, color);
        resolve(color);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = imgUrl;
  });
}
async function applyDynamicAccent(coverUrl) {
  const color = await extractDominantColor(coverUrl);
  if (!color) {
    document.documentElement.style.removeProperty("--dynamic-accent");
    return;
  }
  document.documentElement.style.setProperty("--dynamic-accent", color);
}

/* -----------------------------------------------------
  40. Wave 5 — Paroles synchronisées (lrclib.net, no key)
   ----------------------------------------------------- */
let _lyricsCache = new Map();
async function fetchLyrics(artist, title) {
  if (!artist || !title) return null;
  const key = `${artist}::${title}`.toLowerCase();
  if (_lyricsCache.has(key)) return _lyricsCache.get(key);
  try {
    const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
    const r = await fetch(url);
    if (!r.ok) { _lyricsCache.set(key, null); return null; }
    const data = await r.json();
    const result = { synced: data.syncedLyrics || null, plain: data.plainLyrics || null };
    _lyricsCache.set(key, result);
    return result;
  } catch { return null; }
}
function parseSyncedLyrics(synced) {
  if (!synced) return [];
  const lines = [];
  for (const raw of synced.split("\n")) {
    const m = raw.match(/^\[(\d+):(\d+)(?:\.(\d+))?\](.*)$/);
    if (!m) continue;
    const t = +m[1] * 60 + +m[2] + (m[3] ? +`0.${m[3]}` : 0);
    lines.push({ t, text: m[4].trim() });
  }
  return lines;
}
let _lyricsLines = [];
let _lyricsStartTs = 0;
function ensureLyricsPanel() {
  if ($("#lyricsPanel")) return;
  const p = document.createElement("aside");
  p.id = "lyricsPanel";
  p.className = "lyrics-panel";
  p.hidden = true;
  p.innerHTML = `
    <header class="lyrics-head" id="lyricsHead">
      <strong>🎤 Paroles</strong>
      <span class="lyrics-status" id="lyricsStatus">—</span>
      <button type="button" class="lyrics-min" aria-label="Réduire" title="Réduire">–</button>
      <button type="button" class="lyrics-close" aria-label="Fermer les paroles" title="Fermer">×</button>
    </header>
    <div class="lyrics-body" id="lyricsBody"><p class="lyrics-empty">En attente du prochain titre…</p></div>`;
  document.body.appendChild(p);
  p.querySelector(".lyrics-close").addEventListener("click", toggleLyrics);
  p.querySelector(".lyrics-min").addEventListener("click", () => {
    p.classList.toggle("is-min");
    p.querySelector(".lyrics-min").textContent = p.classList.contains("is-min") ? "□" : "–";
  });
  // Drag
  const head = p.querySelector(".lyrics-head");
  let drag = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const r = p.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
    p.classList.add("is-drag");
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const x = Math.max(8, Math.min(window.innerWidth - p.offsetWidth - 8, e.clientX - drag.dx));
    const y = Math.max(8, Math.min(window.innerHeight - 60, e.clientY - drag.dy));
    p.style.left = x + "px"; p.style.top = y + "px"; p.style.right = "auto";
  });
  head.addEventListener("pointerup", () => { drag = null; p.classList.remove("is-drag"); });
}
function toggleLyrics() {
  ensureLyricsPanel();
  const p = $("#lyricsPanel");
  p.hidden = !p.hidden;
  if (!p.hidden) refreshLyrics();
}
async function refreshLyrics() {
  const status = $("#lyricsStatus");
  const body = $("#lyricsBody");
  if (!body) return;
  if (!currentTrack || !currentTrack.artist || !currentTrack.title) {
    body.innerHTML = `<p class="lyrics-empty">Aucun titre détecté (CORS bloque le flux Centova depuis le navigateur).</p>`;
    if (status) status.textContent = "—";
    _lyricsLines = [];
    return;
  }
  if (status) status.textContent = "Recherche…";
  const lyrics = await fetchLyrics(currentTrack.artist, currentTrack.title);
  if (!lyrics || (!lyrics.synced && !lyrics.plain)) {
    body.innerHTML = `<p class="lyrics-empty">Pas de paroles trouvées pour <em>${escapeHtml(currentTrack.title)}</em>.</p>`;
    if (status) status.textContent = "Aucun résultat";
    _lyricsLines = [];
    return;
  }
  if (lyrics.synced) {
    _lyricsLines = parseSyncedLyrics(lyrics.synced);
    _lyricsStartTs = Date.now();
    body.innerHTML = _lyricsLines.map((l, i) => `<p class="lyrics-line" data-i="${i}">${escapeHtml(l.text || "♪")}</p>`).join("");
    if (status) status.textContent = "Synchronisé";
  } else {
    _lyricsLines = [];
    body.innerHTML = `<pre class="lyrics-plain">${escapeHtml(lyrics.plain)}</pre>`;
    if (status) status.textContent = "Texte simple";
  }
}
function tickLyrics() {
  if (!_lyricsLines.length) return;
  const panel = $("#lyricsPanel");
  if (!panel || panel.hidden) return;
  const elapsed = (Date.now() - _lyricsStartTs) / 1000;
  let active = 0;
  for (let i = 0; i < _lyricsLines.length; i++) {
    if (_lyricsLines[i].t <= elapsed) active = i;
    else break;
  }
  $$(".lyrics-line", panel).forEach((el, i) => {
    el.classList.toggle("is-active", i === active);
    el.classList.toggle("is-past", i < active);
  });
  const activeEl = panel.querySelector(`.lyrics-line[data-i="${active}"]`);
  if (activeEl) activeEl.scrollIntoView({ block: "center", behavior: "smooth" });
}

/* -----------------------------------------------------
  41. Wave 5 — Réactions emoji live (engagement)
   ----------------------------------------------------- */
function injectReactions() {
  if ($("#reactionsBar")) return;
  const player = $("#player");
  if (!player) return;
  const bar = document.createElement("div");
  bar.id = "reactionsBar";
  bar.className = "reactions-bar";
  bar.setAttribute("aria-label", "Réactions");
  const emojis = ["🔥", "❤️", "🎉", "🕺", "💯", "🤘"];
  bar.innerHTML = emojis.map((e) => `<button type="button" class="reaction-btn" data-emoji="${e}" aria-label="Réagir ${e}">${e}</button>`).join("");
  player.appendChild(bar);
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".reaction-btn");
    if (!btn) return;
    floatEmoji(btn.dataset.emoji, btn);
    const stats = (window.__statsCounts = window.__statsCounts || {});
    stats[btn.dataset.emoji] = (stats[btn.dataset.emoji] || 0) + 1;
    btn.classList.add("is-pop");
    setTimeout(() => btn.classList.remove("is-pop"), 250);
  });
}
function floatEmoji(emoji, fromEl) {
  const layer = ensureFloatLayer();
  const rect = fromEl.getBoundingClientRect();
  for (let i = 0; i < 3; i++) {
    const span = document.createElement("span");
    span.className = "float-emoji";
    span.textContent = emoji;
    span.style.left = `${rect.left + rect.width / 2 + (Math.random() * 40 - 20)}px`;
    span.style.top = `${rect.top}px`;
    span.style.setProperty("--dx", `${Math.random() * 80 - 40}px`);
    span.style.setProperty("--dy", `-${120 + Math.random() * 100}px`);
    span.style.setProperty("--dur", `${1.4 + Math.random() * 0.8}s`);
    layer.appendChild(span);
    setTimeout(() => span.remove(), 2400);
  }
}
function ensureFloatLayer() {
  let layer = $("#floatLayer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "floatLayer";
    layer.className = "float-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
  }
  return layer;
}

/* -----------------------------------------------------
  42. Wave 5 — Picture-in-Picture audio (canvas vidéo)
   ----------------------------------------------------- */
let _pipVideo = null;
let _pipCanvas = null;
let _pipRAF = 0;
async function togglePip() {
  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture();
    return;
  }
  if (!_pipCanvas) {
    _pipCanvas = document.createElement("canvas");
    _pipCanvas.width = 480; _pipCanvas.height = 270;
  }
  if (!_pipVideo) {
    _pipVideo = document.createElement("video");
    _pipVideo.muted = true;
    _pipVideo.playsInline = true;
    _pipVideo.srcObject = _pipCanvas.captureStream(30);
    _pipVideo.style.position = "fixed";
    _pipVideo.style.left = "-9999px";
    document.body.appendChild(_pipVideo);
    await _pipVideo.play().catch(() => {});
  }
  drawPipFrame();
  try {
    await _pipVideo.requestPictureInPicture();
    toast("Picture-in-Picture activé", "ok");
  } catch (e) {
    toast("PiP non disponible sur ce navigateur", "warn");
  }
}
function drawPipFrame() {
  if (!_pipCanvas) return;
  const ctx = _pipCanvas.getContext("2d");
  const w = _pipCanvas.width, h = _pipCanvas.height;
  // Fond
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#1a0610");
  grad.addColorStop(1, "#06060a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // Pochette
  if (currentCover) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { try { ctx.drawImage(img, 20, 20, 230, 230); } catch {} };
    img.src = currentCover;
  } else {
    ctx.fillStyle = "#c8102e";
    ctx.fillRect(20, 20, 230, 230);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 64px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("HR", 135, 140);
  }
  // Texte
  ctx.fillStyle = "#fff";
  ctx.font = "bold 22px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("● LIVE", 270, 50);
  ctx.fillStyle = "#ff3a6e";
  const slot = currentSlot || getCurrentSlot();
  ctx.font = "bold 20px system-ui, sans-serif";
  wrapText(ctx, slot?.title || "Hit Radio", 270, 90, 200, 24);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "16px system-ui, sans-serif";
  if (currentTrack?.title) {
    ctx.fillText(`♪ ${currentTrack.title.slice(0, 22)}`, 270, 200);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(currentTrack.artist?.slice(0, 24) || "", 270, 224);
  } else {
    ctx.fillText(slot?.host || "Programmation", 270, 200);
  }
  // Barre viz
  if (analyser && !audio?.paused) {
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buf);
    const bars = 40, bw = w / bars;
    for (let i = 0; i < bars; i++) {
      const v = buf[i * 2] / 255;
      const bh = v * 30 + 2;
      ctx.fillStyle = `hsla(${340 + v * 30}, 90%, 60%, 0.7)`;
      ctx.fillRect(i * bw, h - bh, bw - 1, bh);
    }
  }
  _pipRAF = requestAnimationFrame(drawPipFrame);
}
function wrapText(ctx, text, x, y, maxW, lh) {
  const words = (text || "").split(" ");
  let line = "";
  for (const w of words) {
    const test = line + w + " ";
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line.trim(), x, y);
      line = w + " ";
      y += lh;
    } else line = test;
  }
  ctx.fillText(line.trim(), x, y);
}

/* -----------------------------------------------------
  43. Wave 5 — Cheat-sheet raccourcis (touche ?)
   ----------------------------------------------------- */
const SHORTCUTS = [
  ["Espace", "Lecture / Pause"],
  ["M", "Couper le son"],
  ["↑ / ↓", "Volume"],
  ["Ctrl + K", "Recherche rapide"],
  ["L", "Paroles synchronisées"],
  ["W", "Mode plein écran"],
  ["P", "Picture-in-Picture"],
  ["E", "Égaliseur"],
  ["H", "Historique"],
  ["?", "Cette aide"],
  ["Échap", "Fermer un panneau"],
];
function ensureShortcutsPanel() {
  if ($("#shortcutsPanel")) return;
  const p = document.createElement("div");
  p.id = "shortcutsPanel";
  p.className = "shortcuts-panel";
  p.hidden = true;
  p.innerHTML = `
    <div class="shortcuts-card">
      <header><strong>⌨ Raccourcis clavier</strong><button type="button" class="shortcuts-close" aria-label="Fermer">×</button></header>
      <table>
        <tbody>
          ${SHORTCUTS.map(([k, d]) => `<tr><td><kbd>${k}</kbd></td><td>${d}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  document.body.appendChild(p);
  p.addEventListener("click", (e) => { if (e.target === p) toggleShortcuts(); });
  p.querySelector(".shortcuts-close").addEventListener("click", toggleShortcuts);
}
function toggleShortcuts() {
  ensureShortcutsPanel();
  const p = $("#shortcutsPanel");
  p.hidden = !p.hidden;
}

/* -----------------------------------------------------
  44. Wave 5 — Onboarding tour (1er visite)
   ----------------------------------------------------- */
const TOUR_KEY = "hr.tour.v5";
const TOUR_STEPS = [
  { sel: "#playToggle", title: "Lecture", text: "Clique ici (ou appuie sur Espace) pour lancer le direct." },
  { sel: "#mtlWeather", title: "Météo Montréal", text: "Toujours à jour, mise à jour toutes les 10 min." },
  { sel: "#watchOpenBtn", title: "Mode plein écran", text: "Ouvre l'écran Watch avec visualizer XL." },
  { sel: "#reactionsBar", title: "Réactions", text: "Envoie 🔥 ❤️ 🎉 pour réagir au direct." },
  { sel: "#bottomNav", title: "Navigation rapide", text: "Sur mobile, accède partout depuis le bas. (Appuie Échap pour finir.)" },
];
function startTour(force = false) {
  if (!force && store.get(TOUR_KEY, "0") === "1") return;
  let step = 0;
  const overlay = document.createElement("div");
  overlay.className = "tour-overlay";
  overlay.innerHTML = `<div class="tour-bubble"></div>`;
  document.body.appendChild(overlay);
  const bubble = overlay.querySelector(".tour-bubble");
  function show() {
    while (step < TOUR_STEPS.length && !$(TOUR_STEPS[step].sel)) step++;
    if (step >= TOUR_STEPS.length) return done();
    const s = TOUR_STEPS[step];
    const target = $(s.sel);
    const r = target.getBoundingClientRect();
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => {
      const r2 = target.getBoundingClientRect();
      bubble.innerHTML = `
        <strong>${escapeHtml(s.title)}</strong>
        <p>${escapeHtml(s.text)}</p>
        <div class="tour-actions">
          <button type="button" class="tour-skip">Passer</button>
          <button type="button" class="tour-next">${step === TOUR_STEPS.length - 1 ? "Terminer" : "Suivant"}</button>
        </div>
        <span class="tour-step">${step + 1} / ${TOUR_STEPS.length}</span>`;
      const top = Math.min(window.innerHeight - 180, Math.max(20, r2.bottom + 12));
      const left = Math.min(window.innerWidth - 320, Math.max(20, r2.left));
      bubble.style.top = `${top}px`;
      bubble.style.left = `${left}px`;
      target.classList.add("tour-spotlight");
      bubble.querySelector(".tour-next").onclick = () => { target.classList.remove("tour-spotlight"); step++; show(); };
      bubble.querySelector(".tour-skip").onclick = done;
    }, 350);
  }
  function done() {
    overlay.remove();
    document.querySelectorAll(".tour-spotlight").forEach((el) => el.classList.remove("tour-spotlight"));
    store.set(TOUR_KEY, "1");
  }
  show();
}

/* -----------------------------------------------------
  45. Wave 5 — Boutons header & raccourcis globaux
   ----------------------------------------------------- */
function injectV5Tools() {
  const tools = $(".header-tools");
  if (!tools) return;
  // 1) Construit/récupère le menu d'overflow
  let more = $("#moreBtn");
  if (!more) {
    more = document.createElement("button");
    more.type = "button"; more.id = "moreBtn"; more.className = "header-tool more-btn";
    more.title = "Plus d'outils"; more.setAttribute("aria-label", "Plus d'outils");
    more.setAttribute("aria-haspopup", "true");
    more.setAttribute("aria-expanded", "false");
    more.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`;
    const menu = document.createElement("div");
    menu.id = "moreMenu"; menu.className = "more-menu"; menu.hidden = true;
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      more.setAttribute("aria-expanded", String(open));
      if (open) {
        const r = more.getBoundingClientRect();
        menu.style.top = (r.bottom + 8) + "px";
        menu.style.right = (window.innerWidth - r.right) + "px";
      }
    });
    document.addEventListener("click", (e) => {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== more) { menu.hidden = true; more.setAttribute("aria-expanded", "false"); }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { menu.hidden = true; more.setAttribute("aria-expanded", "false"); } });
    tools.appendChild(more);
  }
  const menu = $("#moreMenu");
  function addMenuItem(id, icon, label, handler) {
    if ($("#" + id)) return;
    const item = document.createElement("button");
    item.type = "button"; item.id = id; item.className = "more-item"; item.setAttribute("role", "menuitem");
    item.innerHTML = `<span class="more-ico" aria-hidden="true">${icon}</span><span>${label}</span>`;
    item.addEventListener("click", () => { menu.hidden = true; more.setAttribute("aria-expanded", "false"); handler(); });
    menu.appendChild(item);
  }
  addMenuItem("miLyrics", "🎤", "Paroles", toggleLyrics);
  addMenuItem("miPip",    "🗔", "Picture-in-Picture", togglePip);
  addMenuItem("miWatch",  "⛶",  "Mode plein écran", openWatch);
  addMenuItem("miHelp",   "⌨",  "Raccourcis clavier", toggleShortcuts);
  addMenuItem("miTour",   "✌",  "Revoir le tour", () => startTour(true));
}

function consolidateHeaderTools() {
  // Déplace les boutons secondaires dans le menu "Plus"
  const menu = $("#moreMenu");
  if (!menu) return;
  const map = [
    ["#sleepBtn", "💤", "Minuteur de sommeil"],
    // EQ retiré : le flux SHOUTcast n'a pas CORS, Web Audio mute la sortie
    ["#notifBtn", "🔔", "Notifications de show"],
    ["#installPwaBtn", "⬇", "Installer l'app"],
  ];
  // Cache aussi le bouton EQ original
  $("#eqBtn")?.classList.add("is-collapsed");
  for (const [sel, ico, label] of map) {
    const btn = $(sel);
    if (!btn) continue;
    if ($("#mi_" + btn.id)) continue;
    const wrap = document.createElement("button");
    wrap.type = "button";
    wrap.className = "more-item";
    wrap.setAttribute("role", "menuitem");
    wrap.id = "mi_" + btn.id;
    wrap.innerHTML = `<span class="more-ico" aria-hidden="true">${ico}</span><span>${label}</span>`;
    wrap.addEventListener("click", (ev) => {
      ev.stopPropagation();
      menu.hidden = true;
      $("#moreBtn")?.setAttribute("aria-expanded", "false");
      // Cas spécial : le sous-menu sleep doit être ancré sur un élément visible.
      // L'original #sleepBtn est is-collapsed (rect = 0,0), donc on ancre sur le
      // bouton "Plus" pour positionner correctement.
      if (btn.id === "sleepBtn" && typeof toggleSleepMenu === "function") {
        const anchor = $("#moreBtn") || wrap;
        toggleSleepMenu(anchor);
      } else {
        btn.click();
      }
    });
    menu.appendChild(wrap);
    btn.classList.add("is-collapsed");
  }
}
function bindV5Hotkeys() {
  document.addEventListener("keydown", (e) => {
    // Ne pas intercepter dans les inputs
    const tag = (e.target?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case " ":
        e.preventDefault();
        if (audio?.paused) void startPlayback(); else pausePlayback();
        break;
      case "m": case "M": toggleMute(); break;
      case "l": case "L": toggleLyrics(); break;
      case "w": case "W": openWatch(); break;
      case "p": case "P": togglePip(); break;
      case "?": toggleShortcuts(); break;
      case "ArrowUp": case "ArrowDown": {
        if (!audio) return;
        const dir = e.key === "ArrowUp" ? 0.05 : -0.05;
        audio.volume = Math.min(1, Math.max(0, audio.volume + dir));
        store.set(STORAGE.vol, String(audio.volume));
        e.preventDefault();
        break;
      }
    }
  });
}

/* -----------------------------------------------------
  46. Boot
   ----------------------------------------------------- */
function init() {
  // A11y : skip link "Aller au contenu" inject\u00e9 en premier focusable
  if (!document.querySelector(".skip-link")) {
    const main = document.querySelector("main");
    if (main && !main.id) main.id = "main";
    const targetId = (main?.id) || "main";
    const skip = document.createElement("a");
    skip.className = "skip-link";
    skip.href = `#${targetId}`;
    skip.textContent = "Aller au contenu";
    document.body.insertBefore(skip, document.body.firstChild);
    if (main) main.setAttribute("tabindex", "-1");
  }

  // Badge "Tu \u00e9coutes depuis\u2026" dans le panneau plein
  const fullPanel = document.getElementById("player");
  if (fullPanel && !document.getElementById("sessionBadgeFull")) {
    const b = document.createElement("p");
    b.id = "sessionBadgeFull";
    b.className = "session-badge";
    b.hidden = true;
    fullPanel.appendChild(b);
  }

  ensureAudio();
  bindAudioEvents();

  const fullUI = makeFullPanelUI();
  if (fullUI) playerUIs.add(fullUI);
  const miniUI = makeMiniPlayerUI();
  if (miniUI) playerUIs.add(miniUI);

  applyVolumeFromStore();
  renderOnAir();
  renderClock();
  setInterval(renderClock, 1000);
  setInterval(renderOnAir, 30_000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { renderClock(); renderOnAir(); void refreshLiveTrack(); }
  });

  // Lecture auto-resume si l'utilisateur écoutait avant nav
  const autoplayParam = new URLSearchParams(location.search).get("play") === "1";
  const wasPlaying = store.get(STORAGE.playing, "0") === "1";
  if (autoplayParam || wasPlaying) {
    requestAnimationFrame(() => {
      $("#player")?.scrollIntoView({ behavior: "smooth", block: "center" });
      void startPlayback();
      if (autoplayParam) {
        try {
          const u = new URL(location.href);
          u.searchParams.delete("play");
          history.replaceState(null, "", `${u.pathname}${u.search}${u.hash}`);
        } catch { /* noop */ }
      }
    });
  }

  // Lien "Écouter sur la page"
  $("#listenOnPage")?.addEventListener("click", async (e) => {
    e.preventDefault();
    $("#player")?.scrollIntoView({ behavior: "smooth", block: "center" });
    await startPlayback();
    $("#playToggle")?.focus({ preventScroll: true });
  });

  // Lien "Écouter le direct" sur sous-pages : démarre direct sans recharger
  $$(".listen-strip-link").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      void startPlayback();
    });
  });

  bindNav();
  bindShortcuts();
  bindContactForm();
  buildScheduleTable();
  $("#downloadIcs")?.addEventListener("click", (e) => { e.preventDefault(); downloadIcs(); });
  $("#openHistoryBtn")?.addEventListener("click", (e) => { e.preventDefault(); toggleHistory(true); });

  // Historique : pré-charge depuis storage
  renderHistory();

  // V2 features
  injectHeaderTools();
  applyTheme(store.get(THEME_KEY, "auto"));
  bindConnectivity();
  injectJsonLd();
  annotateTalentCards();
  renderCountdown();
  setInterval(renderCountdown, 30_000);

  // Visualiseur : démarre au premier play
  audio.addEventListener("play", () => {
    if (audioCtx?.state === "suspended") audioCtx.resume();
    setupVisualizer();
    setupEq();
    startStatsTracking();
  }, { once: true });

  // Ctrl+K / Cmd+K : ouvre la recherche
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault(); openSearch();
    }
  });

  // V3 : favoris, notifs, historique enrichi, deep links, a11y, stats page
  injectFavButtons();
  injectFavFilter();
  injectExtraHeaderTools();
  injectHistorySearch();
  handleDeepLinks();
  ensureLiveRegion();
  renderStatsPage();
  // Vérifie le slot toutes les minutes pour notifier les changements
  checkSlotChange();
  setInterval(checkSlotChange, 60_000);

  // V4 : rails, météo, bottom nav, watch mode
  renderAllRails();
  setInterval(renderRailUpcoming, 60_000);
  loadWeather();
  setInterval(loadWeather, 10 * 60_000);
  injectBottomNav();
  injectWatchButton();

  // V5 : couleur dynamique, paroles, réactions, PiP, raccourcis, tour
  injectV5Tools();
  injectReactions();
  bindV5Hotkeys();
  consolidateHeaderTools();
  // Tick paroles & couleur dynamique alignés au refresh nowplaying
  setInterval(() => {
    tickLyrics();
    if (currentCover) applyDynamicAccent(currentCover);
  }, 1000);
  // Lance le tour onboarding au 1er chargement après 1.5s
  // Désactivé : laissé accessible via menu "Plus → Revoir le tour"
  // setTimeout(() => startTour(false), 1500);

  // Now playing
  void refreshLiveTrack();
  setInterval(refreshLiveTrack, 25_000);

  // Phase 2 — UX
  initPhase2UX();

  // Phase 5 — UX surprise : ticker, vumetre, fullscreen player,
  //                         skeleton metas, scroll-reveal etendu, back-to-top
  initPhase5UX();

  // Phase 3 — Multi-tab sync : pause les autres onglets quand un démarre
  initMultiTabSync();

  registerSW();
}

/* -----------------------------------------------------
  47b. PHASE 3 — Multi-tab sync via BroadcastChannel
   ----------------------------------------------------- */
let hrChannel = null;
function initMultiTabSync() {
  if (!("BroadcastChannel" in window)) return;
  try {
    hrChannel = new BroadcastChannel("hitradio-sync");
    hrChannel.addEventListener("message", (e) => {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.type === "play-claim" && audio && !audio.paused) {
        // Un autre onglet a démarré la lecture → on pause ici
        pausePlayback();
        toast("Lecture reprise dans un autre onglet", "info", 3500);
      }
    });
    // Annonce quand l'audio démarre vraiment dans cet onglet
    if (audio && !audio.dataset.hrSyncBound) {
      audio.dataset.hrSyncBound = "1";
      audio.addEventListener("playing", () => {
        try { hrChannel?.postMessage({ type: "play-claim", ts: Date.now() }); } catch {}
      });
    }
  } catch (err) {
    console.warn("[HitRadio] BroadcastChannel error", err);
  }

  // Phase 3 — cleanup avant fermeture (libère l'audio + le channel)
  window.addEventListener("beforeunload", () => {
    try { hrChannel?.close(); } catch {}
  });
}

/* -----------------------------------------------------
  47. PHASE 2 — UX (swipe, double-tap mute, now-playing drawer)
   ----------------------------------------------------- */
function initPhase2UX() {
  // 2.1 — Swipe vers le bas pour masquer le mini-player (mobile)
  const mini = document.getElementById("miniPlayer");
  if (mini) {
    let startY = 0, startX = 0, dragging = false;
    mini.addEventListener("touchstart", (e) => {
      if (e.target.closest("button, input")) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      dragging = true;
      mini.style.transition = "none";
    }, { passive: true });
    mini.addEventListener("touchmove", (e) => {
      if (!dragging) return;
      const dy = e.touches[0].clientY - startY;
      const dx = Math.abs(e.touches[0].clientX - startX);
      if (dy > 10 && dx < 40) {
        mini.style.transform = `translateY(${Math.min(dy, 140)}px)`;
        mini.style.opacity = String(Math.max(0.3, 1 - dy / 200));
      }
    }, { passive: true });
    mini.addEventListener("touchend", (e) => {
      if (!dragging) return;
      dragging = false;
      mini.style.transition = "";
      const dy = (e.changedTouches[0]?.clientY ?? 0) - startY;
      mini.style.transform = "";
      mini.style.opacity = "";
      if (dy > 80) {
        mini.classList.add("is-hidden");
        mini.classList.remove("is-shown");
        sessionStorage.setItem("hr.miniHidden", "1");
        toast("Lecteur masqué — touche M pour le rappeler", "info");
      }
    });
  }

  // Raccourci pour rappeler le mini-player après un swipe-dismiss
  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "p" && !e.target.closest("input, textarea, [contenteditable]")) {
      const m = document.getElementById("miniPlayer");
      if (m && m.classList.contains("is-hidden")) {
        m.classList.remove("is-hidden");
        m.classList.add("is-shown");
        sessionStorage.removeItem("hr.miniHidden");
      }
    }
  });

  // 2.2 — Double-tap sur la pochette = mute
  const cover = document.getElementById("playerCover") || document.querySelector(".player-cover");
  if (cover) {
    let lastTap = 0;
    cover.addEventListener("click", (e) => {
      const now = Date.now();
      if (now - lastTap < 320) {
        e.preventDefault();
        toggleMute();
        cover.classList.add("just-muted");
        setTimeout(() => cover.classList.remove("just-muted"), 600);
        lastTap = 0;
        return;
      }
      lastTap = now;
      // Single click (différé) = ouvrir le drawer
      setTimeout(() => {
        if (lastTap && Date.now() - lastTap >= 300) {
          openNowPlayingDrawer();
          lastTap = 0;
        }
      }, 320);
    });
    cover.style.cursor = "pointer";
    cover.setAttribute("title", "Cliquer : agrandir — Double-clic : muet");
  }
}

/* 2.3 — Drawer plein écran "Now Playing" */
function ensureNowPlayingDrawer() {
  let d = document.getElementById("nowPlayingDrawer");
  if (d) return d;
  d = document.createElement("div");
  d.id = "nowPlayingDrawer";
  d.className = "np-drawer";
  d.hidden = true;
  d.setAttribute("role", "dialog");
  d.setAttribute("aria-modal", "true");
  d.setAttribute("aria-label", "Lecture en cours");
  d.innerHTML = `
    <div class="np-bg" aria-hidden="true"></div>
    <button class="np-close" type="button" aria-label="Fermer">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
    </button>
    <div class="np-inner">
      <img class="np-cover" id="npCover" alt="" />
      <div class="np-meta">
        <span class="np-tag" id="npTag">Hit Radio</span>
        <h2 class="np-title" id="npTitle">Les Hits Dance Music</h2>
        <p class="np-host" id="npHost"></p>
        <p class="np-track" id="npTrack" hidden></p>
      </div>
      <div class="np-actions">
        <button class="btn-primary" id="npPlay" type="button">▶ Lecture</button>
        <button class="btn-ghost" id="npShare" type="button">Partager</button>
        <button class="btn-ghost" id="npHist" type="button">Historique</button>
      </div>
    </div>`;
  document.body.appendChild(d);

  d.querySelector(".np-close").addEventListener("click", () => closeNowPlayingDrawer());
  d.addEventListener("click", (e) => { if (e.target === d || e.target.classList.contains("np-bg")) closeNowPlayingDrawer(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !d.hidden) closeNowPlayingDrawer(); });

  d.querySelector("#npPlay").addEventListener("click", () => void togglePlayback());
  d.querySelector("#npShare").addEventListener("click", () => shareCurrent());
  d.querySelector("#npHist").addEventListener("click", () => { closeNowPlayingDrawer(); toggleHistory(true); });
  return d;
}
function openNowPlayingDrawer() {
  const d = ensureNowPlayingDrawer();
  // Hydrater avec données courantes
  const cover = document.getElementById("playerCover") || document.querySelector(".player-cover img, .player-cover");
  const coverSrc = (cover && cover.tagName === "IMG") ? cover.src : (currentCover || "");
  const npCover = d.querySelector("#npCover");
  const npBg = d.querySelector(".np-bg");
  if (coverSrc) {
    npCover.src = coverSrc;
    npBg.style.backgroundImage = `url("${coverSrc}")`;
  }
  d.querySelector("#npTitle").textContent = currentSlot?.title || "Hit Radio";
  d.querySelector("#npHost").textContent = currentSlot?.host || "";
  const tag = SLOT_TAGS?.[currentSlot?.tag] || null;
  const npTag = d.querySelector("#npTag");
  if (tag) {
    npTag.textContent = tag.label;
    npTag.style.setProperty("--tag-color", tag.color);
  }
  const trackEl = d.querySelector("#npTrack");
  if (currentTrack && currentTrack.title) {
    trackEl.hidden = false;
    trackEl.textContent = currentTrack.artist ? `♪ ${currentTrack.artist} — ${currentTrack.title}` : `♪ ${currentTrack.title}`;
  } else {
    trackEl.hidden = true;
  }
  const npPlay = d.querySelector("#npPlay");
  npPlay.textContent = (audio && !audio.paused) ? "❚❚ Pause" : "▶ Lecture";
  d.hidden = false;
  // Phase 4 — a11y : focus trap basique
  d.dataset.lastFocus = document.activeElement?.id || "";
  requestAnimationFrame(() => {
    d.classList.add("is-open");
    d.querySelector(".np-close")?.focus();
  });
  if (!d.__trapBound) {
    d.__trapBound = true;
    d.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const focusables = d.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
  document.body.style.overflow = "hidden";
}
function closeNowPlayingDrawer() {
  const d = document.getElementById("nowPlayingDrawer");
  if (!d) return;
  d.classList.remove("is-open");
  document.body.style.overflow = "";
  // Phase 4 — restaurer le focus
  const last = d.dataset.lastFocus ? document.getElementById(d.dataset.lastFocus) : null;
  setTimeout(() => {
    d.hidden = true;
    last?.focus?.();
  }, 280);
}

/* =====================================================
   PHASE 5 — UX surprise (CSS-driven, zero-deps)
   ===================================================== */
function initPhase5UX() {
  injectTicker();
  injectVumeter();
  injectBackToTop();
  extendScrollReveal();
  applyMetaSkeletons();
  applyVinylCursor();
}

// 5.1 Ticker dans l'entete avec maintenant + show
function injectTicker() {
  if (document.getElementById("hrTicker")) return;
  const header = document.querySelector(".site-header");
  if (!header) return;
  const t = document.createElement("div");
  t.id = "hrTicker";
  t.className = "hr-ticker";
  t.setAttribute("aria-live", "off");
  t.innerHTML = `<div class="hr-ticker-track" id="hrTickerTrack">
    <span class="hr-ticker-dot" aria-hidden="true"></span>
    <span class="hr-ticker-text">EN DIRECT — Hit Radio · Les Hits Dance Music</span>
  </div>`;
  header.parentElement.insertBefore(t, header.nextSibling);
  refreshTicker();
  setInterval(refreshTicker, 15_000);
}
function refreshTicker() {
  const txt = document.querySelector("#hrTickerTrack .hr-ticker-text");
  if (!txt) return;
  const slot = currentSlot || (typeof getCurrentSlot === "function" ? getCurrentSlot() : null);
  const parts = ["EN DIRECT"];
  if (slot?.title) parts.push(slot.title);
  if (slot?.host) parts.push(slot.host);
  if (currentTrack) {
    const tk = currentTrack.artist ? `${currentTrack.artist} — ${currentTrack.title}` : currentTrack.title;
    parts.push(`Maintenant : ${tk}`);
  }
  // Repete pour effet defilant continu
  const line = parts.join(" · ");
  txt.textContent = `${line}     ★     ${line}     ★     ${line}`;
}

// 5.2 Vumetre CSS sous le bouton play (panneau plein)
function injectVumeter() {
  const playBtn = document.querySelector("#player #playToggle");
  if (!playBtn || document.getElementById("hrVumeter")) return;
  const v = document.createElement("div");
  v.id = "hrVumeter";
  v.className = "vumeter";
  v.setAttribute("aria-hidden", "true");
  v.innerHTML = Array.from({length: 9}, (_, i) => `<span style="--i:${i}"></span>`).join("");
  // Inserer juste apres le bouton
  playBtn.insertAdjacentElement("afterend", v);
}

// 5.3 Bouton retour en haut
function injectBackToTop() {
  if (document.getElementById("backToTop")) return;
  const btn = document.createElement("button");
  btn.id = "backToTop";
  btn.type = "button";
  btn.className = "back-to-top";
  btn.setAttribute("aria-label", "Retour en haut");
  btn.title = "Retour en haut";
  btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>`;
  btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  document.body.appendChild(btn);
  const onScroll = () => btn.classList.toggle("is-shown", window.scrollY > 600);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

// 5.4 Scroll-reveal etendu (toutes les cartes)
function extendScrollReveal() {
  const sel = ".featured-card, .partner-card, .stream-chip, .requests-card, .rail-card, .show-card, .talent-card, .quick-strip-card, .news-card";
  const targets = document.querySelectorAll(sel);
  if (!targets.length || !("IntersectionObserver" in window)) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return; // respect a11y, deja gere par CSS
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add("hr-reveal-in");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });
  targets.forEach((el, i) => {
    if (el.classList.contains("hr-reveal-in")) return;
    el.classList.add("hr-reveal");
    el.style.setProperty("--reveal-delay", `${Math.min(i * 40, 320)}ms`);
    io.observe(el);
  });
}

// 5.5 Skeletons pour metadonnees (titre / artiste pendant chargement)
function applyMetaSkeletons() {
  const targets = ["#onAirTitle", "#onAirHost", "#liveTrackText", "#miniTrack"];
  targets.forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const txt = (el.textContent || "").trim();
    if (!txt || txt === "—" || txt === "..." || txt === "…") {
      el.classList.add("is-skeleton");
      el.textContent = "";
    }
    // Observe : retire skeleton des qu'on injecte du texte
    const mo = new MutationObserver(() => {
      const v = (el.textContent || "").trim();
      if (v && v !== "—" && v !== "...") el.classList.remove("is-skeleton");
    });
    mo.observe(el, { childList: true, characterData: true, subtree: true });
  });
}

// 5.6 Curseur custom (vinyle) sur boutons play
function applyVinylCursor() {
  const cursor = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="%23131218" stroke="%23dc1430" stroke-width="2"/><circle cx="16" cy="16" r="9" fill="none" stroke="%23dc1430" stroke-width="0.5" opacity="0.6"/><circle cx="16" cy="16" r="6" fill="none" stroke="%23dc1430" stroke-width="0.5" opacity="0.6"/><circle cx="16" cy="16" r="3" fill="%23dc1430"/><circle cx="16" cy="16" r="1" fill="%23131218"/></svg>') 16 16, pointer`;
  document.querySelectorAll("#playToggle, #miniPlay, .btn-play, .player-play").forEach((b) => {
    b.style.cursor = cursor;
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
