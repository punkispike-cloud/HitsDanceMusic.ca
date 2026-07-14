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
import { announce } from "./a11y.js";

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

// Mémorise le dernier état player annoncé (a11y) pour ne réannoncer que les
// transitions vers un état problème (tampon / hors ligne) et la reprise direct.
let lastAnnouncedPlayerState = null;

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
  // a11y : annonce les transitions vers un état problème + la reprise du direct.
  // Ne réannonce pas tant que l'état computed ne change pas (evite le spam
  // "Reconnexion… (n)" à chaque tentative).
  if (s !== lastAnnouncedPlayerState) {
    const wasProblem = lastAnnouncedPlayerState === "buffering" || lastAnnouncedPlayerState === "offline";
    if (s === "buffering" || s === "offline") announce(label || "");
    else if (s === "live" && wasProblem) announce("En direct");
    lastAnnouncedPlayerState = s;
  }
  // Bandeau d'état sous le panneau (reconnexion / hors ligne). #playerBanner
  // n'existe que sur l'accueil (#player) → no-op sur les autres pages.
  const banner = document.getElementById("playerBanner");
  if (banner) {
    if (s === "buffering" || s === "offline") { banner.hidden = false; banner.textContent = label || ""; }
    else { banner.hidden = true; banner.textContent = ""; }
  }
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
export async function startPlayback({ silent = false } = {}) {
  ensureAudio();
  if (!audio) return;
  if (!audio.paused) return;
  try {
    // En mode silencieux (autoplay au chargement), on garde l'UI idle pendant
    // la tentative : pas de libellé « Connexion au direct… » ni de bandeau, pour
    // ne pas braquer l'auditeur à l'arrivée ni fluctuer si le navigateur bloque
    // l'autoplay. Le feedback « Connexion au direct… » ne s'affiche que sur un
    // démarrage explicite (clic, raccourci clavier, MediaSession).
    if (!silent) setPlayingUI(false, "Connexion au direct…");
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
    if (silent) {
      // Autoplay au chargement bloqué par le navigateur (pas d'interaction
      // préalable) : on reste discret (état idle, libellé d'origine) — le
      // listener "premier geste" armé par autoplayOnLoad démarre le flux au
      // premier clic. Pas de toast ici pour ne pas braquer l'auditeur à l'arrivée.
      setPlayingUI(false, "Prêt à écouter");
    } else {
      setPlayingUI(false, "Lecture bloquée — clique à nouveau");
      toast("Lecture bloquée par le navigateur — clique n'importe où pour lancer le direct.", "warn");
    }
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
  if (!audio.paused) {
    // Garde anti-rebond autoplay : si le flux vient d'être démarré par le
    // listener "premier geste" (voir autoplayOnLoad), ce clic est la suite du
    // même geste → on ignore le toggle pour éviter un start→pause immédiat.
    if (Date.now() - _autoplayJustStartedAt < 600) return;
    pausePlayback();
  } else {
    await startPlayback();
  }
}

/* ----- Autoplay à l'accès du site -----
   Les navigateurs interdisent l'autoplay sonore sans interaction préalable
   (Chrome MEI, Safari, Firefox). Stratégie :
   1. On tente startPlayback() au chargement de la page.
   2. Si le flux reste en pause (blocage navigateur), on arme un listener
      "premier geste" (pointerdown / keydown) qui démarre le flux au premier
      clic ou touche clavier, n'importe où sur la page, puis se retire.
   Préférence hr.autoplay (défaut "1") : l'utilisateur peut désactiver. */
let _autoplayJustStartedAt = 0;
let _firstGestureArmed = false;

function armFirstGesture() {
  if (_firstGestureArmed) return;
  _firstGestureArmed = true;
  const opts = { capture: true };
  const fire = () => {
    _autoplayJustStartedAt = Date.now();
    void startPlayback();
  };
  const onPointer = () => {
    document.removeEventListener("keydown", onKey, opts);
    fire();
  };
  const onKey = () => {
    document.removeEventListener("pointerdown", onPointer, opts);
    fire();
  };
  document.addEventListener("pointerdown", onPointer, opts);
  document.addEventListener("keydown", onKey, opts);
}

export async function autoplayOnLoad() {
  if (store.get(STORAGE.autoplay, "1") !== "1") return;
  ensureAudio();
  await startPlayback({ silent: true });
  if (getAudio()?.paused) armFirstGesture();
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
    // Ne signer « tampon » que si une lecture était active : pendant une
    // tentative de démarrage (autoplay bloqué / flux coupé), l'événement
    // waiting ne doit pas afficher le bandeau « connexion perdue/tampon ».
    if (!wantPlay()) return;
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
    // « Connexion perdue » n'a de sens que si une lecture était en cours.
    // Une erreur sur une tentative de démarrage (autoplay bloqué, flux
    // injoignable au load) est déjà gérée par le catch de startPlayback.
    if (!wantPlay()) return;
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
  // On continue de rafraîchir onglet caché SI l'audio joue, pour que les
  // métadonnées MediaSession (écran verrouillé) restent à jour en arrière-plan
  // — c'est précisément le contrat de keepFresh. Sinon (en pause/caché), on sort.
  if (document.hidden && (!audio || audio.paused)) return;
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
