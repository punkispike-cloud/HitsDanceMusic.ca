/* Compteur de présence en temps réel (WS). Visiteurs uniques par clientId. */

import { setPresenceListenerHook } from "./player.js";
import { ensureClientId } from "./client-id.js";

let presenceWS = null;
let presenceWantConnected = true;
let presenceReconnectAttempt = 0;
let presenceReconnectTimer = null;
let presenceListening = false;
let presenceBadgeShown = false;
let presenceLastVisitors = 0;
let presenceLastListeners = 0;

function presenceGetUrl() {
  const meta = document.querySelector('meta[name="hr-presence-url"]');
  const url = (meta?.content || "").trim();
  if (!url) return null;
  if (url.startsWith("http://")) return "ws://" + url.slice(7);
  if (url.startsWith("https://")) return "wss://" + url.slice(8);
  return url;
}

// UUID stable par installation/profil navigateur (js/client-id.js) : permet au
// service presence de compter les visiteurs UNIQUES (et pas les sockets ouverts).
// initPresence n'est appelé qu'après consentement (cf. main.js → startAudience).

function presenceUpdateUI(visitors, listeners) {
  const badge = document.getElementById("presenceBadge");
  if (!badge) return;
  if (!presenceBadgeShown) {
    badge.hidden = false;
    requestAnimationFrame(() => badge.classList.add("is-live"));
    presenceBadgeShown = true;
  }
  const vEl = badge.querySelector('[data-presence="visitors"]');
  const lEl = badge.querySelector('[data-presence="listeners"]');
  if (vEl && visitors !== presenceLastVisitors) {
    vEl.textContent = String(visitors);
    const pill = vEl.closest(".presence-pill");
    if (pill) { pill.classList.remove("is-bumped"); void pill.offsetWidth; pill.classList.add("is-bumped"); }
    presenceLastVisitors = visitors;
  }
  if (lEl && listeners !== presenceLastListeners) {
    lEl.textContent = String(listeners);
    const pill = lEl.closest(".presence-pill");
    if (pill) { pill.classList.remove("is-bumped"); void pill.offsetWidth; pill.classList.add("is-bumped"); }
    presenceLastListeners = listeners;
  }
}

function presenceConnect() {
  const url = presenceGetUrl();
  if (!url) return;
  if (!presenceWantConnected) return;
  if (presenceWS && (presenceWS.readyState === WebSocket.OPEN || presenceWS.readyState === WebSocket.CONNECTING)) return;

  let ws;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.warn("[presence] cannot open WS", err);
    presenceScheduleReconnect();
    return;
  }
  presenceWS = ws;

  ws.addEventListener("open", () => {
    presenceReconnectAttempt = 0;
    try { ws.send(JSON.stringify({ type: "hello", clientId: ensureClientId() })); } catch { /* noop */ }
    if (presenceListening) presenceSendListening(true);
  });

  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg && msg.type === "stats") {
      presenceUpdateUI(msg.visitors | 0, msg.listeners | 0);
    }
  });

  ws.addEventListener("close", () => {
    presenceWS = null;
    presenceScheduleReconnect();
  });

  ws.addEventListener("error", () => {
    try { ws.close(); } catch { /* noop */ }
  });
}

function presenceScheduleReconnect() {
  if (!presenceWantConnected) return;
  if (presenceReconnectTimer) return;
  presenceReconnectAttempt++;
  if (presenceReconnectAttempt > 8) return;
  const delay = Math.min(30000, 1500 * Math.pow(1.6, presenceReconnectAttempt - 1));
  presenceReconnectTimer = setTimeout(() => {
    presenceReconnectTimer = null;
    presenceConnect();
  }, delay);
}

function presenceSendListening(on) {
  if (!presenceWS || presenceWS.readyState !== WebSocket.OPEN) return;
  try {
    presenceWS.send(JSON.stringify({ type: "listening", on: !!on }));
  } catch { /* noop */ }
}

function presenceSetListening(on) {
  presenceListening = !!on;
  presenceSendListening(on);
}

export function initPresence() {
  // Câble le hook player → presence
  setPresenceListenerHook(presenceSetListening);

  // Cycle de vie : reprise visible, online, fermeture
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      presenceWantConnected = true;
      presenceConnect();
    }
  });
  window.addEventListener("online", () => {
    presenceWantConnected = true;
    presenceReconnectAttempt = 0;
    presenceConnect();
  });
  window.addEventListener("pagehide", () => {
    presenceWantConnected = false;
    if (presenceReconnectTimer) { clearTimeout(presenceReconnectTimer); presenceReconnectTimer = null; }
    try { presenceWS?.close(1000, "pagehide"); } catch { /* noop */ }
    presenceWS = null;
  });

  // Démarrage différé pour ne pas concurrencer le rendu critique
  if (document.readyState === "complete") {
    setTimeout(presenceConnect, 600);
  } else {
    window.addEventListener("load", () => setTimeout(presenceConnect, 600), { once: true });
  }
}
