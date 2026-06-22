/* Player core : audio singleton, reconnexion résiliente, watchdog, wake lock,
   session clock, MediaSession. Exporte les fonctions utilisées par les UI
   et les modules externes (presence, multi-tab, etc.). */

import { $, haptic } from "./util.js";
import { store, STORAGE } from "./store.js";
import { state } from "./state.js";
import { getCurrentSlot, SLOT_TAGS, highlightCurrentSlot } from "./schedule.js";
import { getMontrealParts } from "./time.js";
import { STREAM_URL, fetchNowPlaying, fetchCover, fallbackCoverDataUri, pushHistory } from "./now-playing.js";
import { toast } from "./toast.js";

let audio = null;
export const playerUIs = new Set();

// Hook optionnel pour le service presence (signal d'écoute).
// Renseigné par presence.js via setPresenceListenerHook(fn).
let presenceListenerHook = null;
export function setPresenceListenerHook(fn) { presenceListenerHook = fn; }

// Hook optionnel pour le mode Watch (syncWatch) — câblé par watch.js.
let watchSyncHook = null;
export function setWatchSyncHook(fn) { watchSyncHook = fn; }

// Hook optionnel pour annoncer un nouveau morceau (a11y), câblé par a11y/track.
let announceTrackHook = null;
export function setAnnounceTrackHook(fn) { announceTrackHook = fn; }

export function getAudio() { return audio; }

export function ensureAudio() {
  audio = $("#radioPlayer");
  if (!audio) {
    audio = document.createElement("audio");
    audio.id = "radioPlayer";
    audio.preload = "auto";
    const src = document.createElement("source");
    src.src = STREAM_URL;
    src.type = "audio/mpeg";
    audio.appendChild(src);
    document.body.appendChild(audio);
  }
  return audio;
}

export function applyVolumeFromStore() {
  if (!audio) return;
  const vol = parseFloat(store.get(STORAGE.vol, "0.85")) || 0.85;
  const muted = store.get(STORAGE.mute, "0") === "1";
  audio.volume = vol;
  audio.muted = muted;
  for (const ui of playerUIs) ui.syncVolume(vol, muted);
}

export function setVolume(v, persist = true) {
  if (!audio) return;
  const clamped = Math.max(0, Math.min(1, v));
  audio.volume = clamped;
  if (clamped > 0) audio.muted = false;
  if (persist) store.set(STORAGE.vol, clamped);
  for (const ui of playerUIs) ui.syncVolume(clamped, audio.muted);
}

export function toggleMute() {
  if (!audio) return;
  audio.muted = !audio.muted;
  store.set(STORAGE.mute, audio.muted ? "1" : "0");
  for (const ui of playerUIs) ui.syncVolume(audio.volume, audio.muted);
}

export function setPlayingUI(isPlaying, label) {
  for (const ui of playerUIs) ui.setState(isPlaying, label);
  document.body.classList.toggle("is-playing-radio", isPlaying);
  if (presenceListenerHook) presenceListenerHook(isPlaying);
  // Header play button : sync visuel + libellé
  const hp = document.getElementById("headerPlay");
  if (hp) {
    hp.classList.toggle("is-playing", isPlaying);
    hp.dataset.state = isPlaying ? "playing" : "paused";
    hp.setAttribute("aria-label", isPlaying ? "Mettre la radio en pause" : "Lancer la radio");
    const lbl = hp.querySelector(".hp-label");
    if (lbl) lbl.textContent = isPlaying ? "En direct" : "Écouter";
  }
  // État lisible pour le CSS (live / buffering / offline / paused)
  let s = "idle";
  const l = (label || "").toLowerCase();
  if (isPlaying) s = "live";
  else if (l.includes("tampon") || l.includes("connexion")) s = "buffering";
  else if (l.includes("indisponible") || l.includes("bloquée") || l.includes("bloquee")) s = "offline";
  else if (l.includes("pause")) s = "paused";
  document.body.dataset.playerState = s;
  const vinyl = $("#vinylDisc");
  if (vinyl) vinyl.classList.toggle("is-spinning", isPlaying);
  if (watchSyncHook) watchSyncHook();
}

/* ----- Wake Lock : empêche l'écran de s'éteindre pendant la lecture ----- */
let _wakeLock = null;
async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request("screen");
    _wakeLock.addEventListener?.("release", () => { _wakeLock = null; });
  } catch { /* batterie faible / HTTP */ }
}
async function releaseWakeLock() {
  try { await _wakeLock?.release(); } catch { /* noop */ }
  _wakeLock = null;
}

/* ----- Session clock : "Tu écoutes depuis Xs" ----- */
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

/* ----- Playback ----- */
export async function startPlayback() {
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

export function pausePlayback() {
  if (!audio) return;
  audio.pause();
  setPlayingUI(false, "En pause");
  store.set(STORAGE.playing, "0");
  void releaseWakeLock();
  pauseSessionClock();
}

export async function togglePlayback() {
  ensureAudio();
  if (!audio) return;
  haptic(12);
  if (!audio.paused) pausePlayback();
  else await startPlayback();
}

/* ----- Audio events : reconnect intelligent + watchdog ----- */
export function bindAudioEvents() {
  if (!audio || audio.dataset.bound === "1") return;
  audio.dataset.bound = "1";

  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let lastTime = 0;
  let lastTimeAt = Date.now();
  let watchdog = null;

  const wantPlay = () => store.get(STORAGE.playing, "0") === "1";

  function scheduleReconnect(reason) {
    if (reconnectTimer) return;
    if (!wantPlay()) return;
    reconnectAttempt++;
    const delay = Math.min(15000, 1000 * Math.pow(2, reconnectAttempt - 1));
    setPlayingUI(false, `Reconnexion… (${reconnectAttempt})`);
    pauseSessionClock();
    console.info(`[HitRadio] reconnect (${reason}) in ${delay}ms`);
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (!wantPlay()) return;
      try {
        audio.src = `${STREAM_URL}?_=${Date.now()}`;
        audio.load();
        await audio.play();
      } catch {
        scheduleReconnect("retry-failed");
      }
    }, delay);
  }
  function cancelReconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempt = 0;
  }
  function startWatchdog() {
    stopWatchdog();
    lastTime = audio.currentTime;
    lastTimeAt = Date.now();
    watchdog = setInterval(() => {
      if (audio.paused) return;
      if (audio.currentTime !== lastTime) {
        lastTime = audio.currentTime;
        lastTimeAt = Date.now();
      } else if (Date.now() - lastTimeAt > 10000) {
        console.warn("[HitRadio] watchdog: stream stalled");
        scheduleReconnect("watchdog");
      }
    }, 3000);
  }
  function stopWatchdog() {
    if (watchdog) { clearInterval(watchdog); watchdog = null; }
  }

  audio.addEventListener("waiting", () => {
    setPlayingUI(false, "Mise en mémoire tampon…");
    // Buffering/reconnexion = pas de son réel → on gèle le compteur d'écoute
    // pour ne pas surcompter le temps pendant les coupures.
    pauseSessionClock();
  });
  audio.addEventListener("playing", () => {
    setPlayingUI(true, "En direct");
    cancelReconnect();
    startWatchdog();
    startSessionClock();
  });
  audio.addEventListener("pause", () => {
    setPlayingUI(false, "En pause");
    stopWatchdog();
    pauseSessionClock();
  });
  audio.addEventListener("stalled", () => scheduleReconnect("stalled"));
  audio.addEventListener("ended", () => scheduleReconnect("ended"));
  audio.addEventListener("error", () => {
    setPlayingUI(false, "Connexion perdue — reconnexion…");
    scheduleReconnect("error");
  });
  audio.addEventListener("volumechange", () => {
    for (const ui of playerUIs) ui.syncVolume(audio.volume, audio.muted);
  });

  window.addEventListener("online", () => {
    if (!wantPlay()) return;
    console.info("[HitRadio] network back online → resume");
    cancelReconnect();
    reconnectAttempt = 0;
    scheduleReconnect("online");
  });
  window.addEventListener("offline", () => {
    if (!audio.paused) {
      setPlayingUI(false, "Hors ligne — reprise auto");
      toast("Réseau perdu. Lecture reprendra dès que possible.", "warn");
    }
  });
}

/* ----- Horloge HH:MM dans le player + slot courant ----- */
export function renderClock() {
  const el = $("#playerClock");
  if (!el) return;
  const { hour, minute } = getMontrealParts();
  el.textContent = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} Québec`;
}

export function renderOnAir() {
  state.currentSlot = getCurrentSlot();
  for (const ui of playerUIs) ui.syncSlot(state.currentSlot);
  highlightCurrentSlot();
  updateMediaSession();
  return state.currentSlot;
}

/* ----- Now playing tick : récupère + pousse aux UI ----- */
let nowPlayingFails = 0;
export async function refreshLiveTrack() {
  if (document.hidden) return;
  const np = await fetchNowPlaying();
  if (!np || !np.title) {
    nowPlayingFails++;
    if (nowPlayingFails === 3) {
      const trackHint = $("#liveTrackHint");
      if (!trackHint) {
        const hint = document.createElement("p");
        hint.id = "liveTrackHint";
        hint.className = "live-track-hint";
        hint.textContent = "Métadonnées morceau indisponibles depuis ce navigateur.";
        $("#player .player-onair-info")?.appendChild(hint);
      }
    }
    state.currentTrack = null;
    for (const ui of playerUIs) ui.syncTrack(null);
    return;
  }
  nowPlayingFails = 0;
  // Métadonnées de nouveau disponibles → retirer le message d'indisponibilité.
  document.getElementById("liveTrackHint")?.remove();
  state.currentTrack = np;
  let coverUrl = null;
  if (np.artist) coverUrl = await fetchCover(np.artist, np.title);
  state.currentCover = coverUrl;
  for (const ui of playerUIs) ui.syncTrack(np, coverUrl);
  pushHistory(np, coverUrl);
  updateMediaSession();
  if (announceTrackHook) announceTrackHook(np);
}

/* ----- MediaSession ----- */
export function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const slot = state.currentSlot || getCurrentSlot();
  const title = state.currentTrack ? (state.currentTrack.title || "Hits Dance Music") : (slot.title || "Hits Dance Music");
  const artist = state.currentTrack ? (state.currentTrack.artist || slot.host || "Hits Dance Music") : (slot.host || "Programmation");
  const artworkSrc = state.currentCover || fallbackCoverDataUri(slot);
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title, artist, album: "Hits Dance Music — La radio",
      artwork: [
        { src: artworkSrc, sizes: "300x300", type: artworkSrc.startsWith("data:") ? "image/svg+xml" : "image/jpeg" },
      ],
    });
    navigator.mediaSession.setActionHandler("play", () => void startPlayback());
    navigator.mediaSession.setActionHandler("pause", () => pausePlayback());
    navigator.mediaSession.setActionHandler("stop", () => pausePlayback());
  } catch { /* noop */ }
}

/* ----- Visibilité : resync au retour, request wake lock si en lecture ----- */
export function bindVisibilityResume() {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      renderClock();
      renderOnAir();
      void refreshLiveTrack();
      if (audio && !audio.paused && !_wakeLock) void requestWakeLock();
    }
  });
}
