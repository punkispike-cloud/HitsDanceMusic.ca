/* Player core : audio singleton, reconnexion résiliente, watchdog, wake lock,
   session clock, MediaSession. Exporte les fonctions utilisées par les UI
   et les modules externes (presence, multi-tab, etc.). */

import { $, haptic } from "./util.js";
import { store, STORAGE } from "./store.js";
import { state } from "./state.js";
import { getCurrentSlot, SLOT_TAGS, highlightCurrentSlot } from "./schedule.js";
import { getMontrealParts } from "./time.js";
import { STREAM_URL, fetchNowPlaying, fetchCover, fallbackCoverDataUri, pushHistory } from "./now-playing.js";
import { BRAND } from "./brand.generated.js";
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

// Dernier état player annoncé (a11y) : on ne réannonce que sur CHANGEMENT d'état,
// sinon « Reconnexion… (3) », « Reconnexion… (4) » spammeraient le lecteur d'écran
// à chaque tentative du watchdog.
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
  // a11y : jusqu'ici l'état n'existait que pour le CSS — un auditeur au lecteur
  // d'écran n'apprenait jamais que le flux bufferise ou est tombé. On annonce les
  // entrées en état problème, et la reprise du direct après un problème (pas les
  // transitions ordinaires play/pause, déjà portées par le bouton).
  if (s !== lastAnnouncedPlayerState) {
    const wasProblem = lastAnnouncedPlayerState === "buffering" || lastAnnouncedPlayerState === "offline";
    if (s === "buffering" || s === "offline") announce(label || "");
    else if (s === "live" && wasProblem) announce("En direct");
    lastAnnouncedPlayerState = s;
  }
  // Bandeau d'état sous le panneau (reconnexion / hors ligne). #playerBanner
  // n'existe que sur l'accueil → no-op ailleurs.
  const banner = document.getElementById("playerBanner");
  if (banner) {
    if (s === "buffering" || s === "offline") {
      banner.hidden = false;
      banner.textContent = label || "";
    } else {
      banner.hidden = true;
      banner.textContent = "";
    }
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

/* ----- Reconnexion & surveillance du flux -----
   L'état vit au niveau module (et non dans une fermeture de bindAudioEvents)
   pour que startPlayback / pausePlayback puissent annuler une tentative en
   attente : un timer orphelin qui se déclenche après coup recharge la source
   et coupe un flux qui venait de repartir. */
const MAX_RECONNECT = 8;
const STARVATION_MS = 5000;   // tampon vide plus longtemps que ça = vraie coupure
const FROZEN_MS = 9000;       // position figée : filet de sécurité
const BUFFERING_UI_MS = 1200; // n'affiche « tampon » que si le hoquet dure

let reconnectTimer = null;
let reconnectAttempt = 0;
let starvationTimer = null;
let bufferingUiTimer = null;
let watchdog = null;
let lastTime = 0;
let lastTimeAt = 0;
let hiccupAtTime = 0; // position au moment où le tampon s'est vidé

const wantPlay = () => store.get(STORAGE.playing, "0") === "1";

function cancelReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempt = 0;
}
function clearHiccupTimers() {
  if (starvationTimer) { clearTimeout(starvationTimer); starvationTimer = null; }
  if (bufferingUiTimer) { clearTimeout(bufferingUiTimer); bufferingUiTimer = null; }
}
function stopWatchdog() {
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
}
function startWatchdog() {
  stopWatchdog();
  if (!audio) return;
  lastTime = audio.currentTime;
  lastTimeAt = Date.now();
  watchdog = setInterval(() => {
    if (!audio || audio.paused || reconnectTimer) return;
    if (audio.currentTime !== lastTime) {
      lastTime = audio.currentTime;
      lastTimeAt = Date.now();
      return;
    }
    if (Date.now() - lastTimeAt > FROZEN_MS) {
      console.warn("[HitRadio] watchdog : position figée");
      reconnectNow("watchdog");
    }
  }, 2000);
}

/* Reconnexion « dure » : nouvelle socket côté serveur. Coûteuse (0,8 s à 2,6 s
   de TTFB mesurés sur cast5, plus le re-remplissage du tampon) → réservée aux
   vraies coupures, jamais aux hoquets réseau passagers. */
function reconnectNow(reason) {
  if (reconnectTimer || !wantPlay() || !audio) return;
  if (reconnectAttempt >= MAX_RECONNECT) {
    stopWatchdog();
    clearHiccupTimers();
    store.set(STORAGE.playing, "0");
    setPlayingUI(false, "Flux indisponible — appuie sur lecture");
    toast("Le flux ne répond plus. Appuie sur ▶ pour réessayer.", "warn");
    return;
  }
  reconnectAttempt++;
  // Backoff exponentiel plafonné + gigue : quand le serveur lâche, il lâche
  // pour tout le monde ; sans gigue, tous les auditeurs reviennent à la même
  // seconde et saturent la reprise.
  const base = Math.min(12_000, 400 * 2 ** (reconnectAttempt - 1));
  const delay = Math.round(base * (0.75 + Math.random() * 0.5));
  setPlayingUI(false, `Reconnexion… (${reconnectAttempt})`);
  pauseSessionClock();
  console.info(`[HitRadio] reconnexion (${reason}) dans ${delay} ms`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (!wantPlay() || !audio) return;
    try {
      audio.src = `${STREAM_URL}?_=${Date.now()}`;
      audio.load();
      await audio.play();
    } catch {
      reconnectNow("échec-tentative");
    }
  }, delay);
}

/* ----- Playback ----- */
export async function startPlayback() {
  ensureAudio();
  if (!audio) return;
  // Un geste utilisateur prime sur toute reconnexion programmée : sinon le
  // timer en attente recharge la source quelques secondes plus tard et coupe
  // le flux que l'utilisateur vient de relancer.
  cancelReconnect();
  clearHiccupTimers();
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
  cancelReconnect();
  clearHiccupTimers();
  stopWatchdog();
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

  audio.addEventListener("waiting", () => {
    // `waiting` = le tampon est réellement vide. Sur un direct, un hoquet de
    // moins d'une seconde est banal : on ne touche pas à l'affichage tout de
    // suite, sinon le player clignote « Mise en mémoire tampon… » plusieurs
    // fois par minute alors que le son ne s'est jamais interrompu.
    if (!bufferingUiTimer) {
      bufferingUiTimer = setTimeout(() => {
        bufferingUiTimer = null;
        setPlayingUI(false, "Mise en mémoire tampon…");
        // Pas de son réel → on gèle le compteur d'écoute pour ne pas
        // surcompter le temps pendant les coupures.
        pauseSessionClock();
      }, BUFFERING_UI_MS);
    }
    // Au-delà de STARVATION_MS le navigateur ne s'en sortira pas seul : la
    // source ne réalimente plus. Une socket neuve repart généralement propre.
    if (!starvationTimer) {
      hiccupAtTime = audio.currentTime;
      starvationTimer = setTimeout(() => {
        starvationTimer = null;
        if (audio && !audio.paused) reconnectNow("tampon vide");
      }, STARVATION_MS);
    }
  });
  audio.addEventListener("playing", () => {
    clearHiccupTimers();
    cancelReconnect();
    setPlayingUI(true, "En direct");
    startWatchdog();
    startSessionClock();
  });
  audio.addEventListener("timeupdate", () => {
    // On désamorce la reconnexion seulement si la position a réellement
    // AVANCÉ depuis le hoquet : certains navigateurs émettent un timeupdate
    // juste après `waiting`, à la même position, et s'y fier annulerait la
    // reprise d'un flux réellement bloqué.
    if (!starvationTimer && !bufferingUiTimer) return;
    if (audio.currentTime > hiccupAtTime) clearHiccupTimers();
  });
  audio.addEventListener("pause", () => {
    setPlayingUI(false, "En pause");
    stopWatchdog();
    pauseSessionClock();
  });
  // `stalled` NE déclenche PAS de reconnexion. Le navigateur l'émet dès que la
  // socket reste ~3 s sans octet, ce qui arrive en permanence sur ce flux :
  // il cesse de lire quand son tampon est plein, et cast5 présente des trous
  // de livraison de 1 à 3,5 s (mesurés). Reconnecter là-dessus détruisait un
  // flux parfaitement sain et provoquait la coupure qu'on croyait subir.
  audio.addEventListener("stalled", () => console.info("[HitRadio] stalled (ignoré)"));
  audio.addEventListener("ended", () => reconnectNow("flux terminé"));
  audio.addEventListener("error", () => {
    setPlayingUI(false, "Connexion perdue — reconnexion…");
    reconnectNow("erreur");
  });
  audio.addEventListener("volumechange", () => {
    for (const ui of playerUIs) ui.syncVolume(audio.volume, audio.muted);
  });

  window.addEventListener("online", () => {
    if (!wantPlay() || !audio) return;
    // Le réseau revient : si la lecture tourne déjà avec du tampon d'avance,
    // elle a survécu à la coupure — la relancer ne ferait que la couper.
    if (!audio.paused && audio.readyState >= 3) return;
    console.info("[HitRadio] réseau rétabli → reprise");
    cancelReconnect();
    reconnectNow("réseau rétabli");
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
  const title = state.currentTrack ? (state.currentTrack.title || BRAND.name) : (slot.title || BRAND.name);
  const artist = state.currentTrack ? (state.currentTrack.artist || slot.host || BRAND.name) : (slot.host || "Programmation");
  const artworkSrc = state.currentCover || fallbackCoverDataUri(slot);
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title, artist, album: `${BRAND.name} — La radio`,
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
