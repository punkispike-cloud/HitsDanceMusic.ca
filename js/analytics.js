/* Beacons d'audience vers l'API (/v1/track) :
   - pageview à l'ouverture
   - heartbeat (temps sur le site) quand l'onglet est visible
   - listen (temps d'écoute par émission) quand la radio joue
   Réutilise le clientId de presence (hr.clientId) pour corréler le visiteur.
   Envois via sendBeacon (fire-and-forget, pas de CORS bloquant, survit à l'unload). */

import { API_BASE } from "./api-config.js";
import { state } from "./state.js";
import { getAudio } from "./player.js";

const TRACK_URL = `${API_BASE}/v1/track`;
const TICK_MS = 20_000;

function getClientId() {
  const KEY = "hr.clientId";
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const id = (crypto?.randomUUID?.() || `${Date.now()}${Math.random().toString(36).slice(2)}`)
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 64);
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return null;
  }
}

function send(payload) {
  const clientId = getClientId();
  if (!clientId) return;
  try {
    const body = JSON.stringify({ clientId, ...payload });
    // text/plain → requête "simple", pas de préflight CORS.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(TRACK_URL, new Blob([body], { type: "text/plain" }));
    } else {
      fetch(TRACK_URL, { method: "POST", body, keepalive: true, mode: "cors" }).catch(() => {});
    }
  } catch { /* noop */ }
}

let _timer = 0;
let _lastTick = Date.now();

export function initAnalytics() {
  if (!getClientId()) return;
  send({ type: "pageview" });

  if (_timer) return;
  _lastTick = Date.now();
  _timer = window.setInterval(() => {
    const now = Date.now();
    // Temps réel écoulé (borné) : robuste si le timer est throttlé en arrière-plan.
    const seconds = Math.min(60, Math.max(1, Math.round((now - _lastTick) / 1000)));
    _lastTick = now;

    const audio = getAudio();
    const playing = audio && !audio.paused;
    if (playing && state.currentSlot?.title) {
      // L'audio joue même onglet caché → on compte l'écoute.
      send({ type: "listen", showTitle: state.currentSlot.title, seconds });
    } else if (!document.hidden) {
      // Temps sur le site : uniquement quand l'onglet est visible.
      send({ type: "heartbeat", seconds });
    }
  }, TICK_MS);

  // Dernier souffle au départ (capture la fin de l'écoute en cours).
  window.addEventListener("pagehide", () => {
    const audio = getAudio();
    if (audio && !audio.paused && state.currentSlot?.title) {
      send({ type: "listen", showTitle: state.currentSlot.title, seconds: 5 });
    }
  });
}
