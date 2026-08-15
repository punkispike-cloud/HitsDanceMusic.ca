/* Abonnement aux rappels d'émission (Web Push). Greffe additive : ne fait rien
   tant qu'un bouton #pushOptIn n'est pas présent (donc seulement podcasts.html).
   Inactif aussi si le navigateur ne supporte pas le push, ou si le serveur n'a
   pas de clé VAPID configurée. */

import { API_BASE } from "./api-config.js";
// L'abonnement push est une action de la personne (clic sur #pushOptIn) : on
// crée l'identifiant à ce moment-là s'il n'existe pas encore.
import { ensureClientId } from "./client-id.js";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getServerKey() {
  try {
    const r = await fetch(`${API_BASE}/v1/push/vapid-public-key`, { mode: "cors", cache: "no-store" });
    if (!r.ok) return null;
    const data = await r.json();
    return data.enabled && data.key ? data.key : null;
  } catch {
    return null;
  }
}

function setBtn(btn, state, label) {
  btn.dataset.state = state;
  btn.textContent = label;
  btn.disabled = false;
}

export async function initPushOptIn() {
  const btn = document.querySelector("#pushOptIn");
  if (!btn) return;

  // Support navigateur.
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    btn.hidden = true;
    return;
  }

  const serverKey = await getServerKey();
  if (!serverKey) {
    btn.hidden = true; // push non configuré côté serveur → on cache le bouton
    return;
  }

  const reg = await navigator.serviceWorker.ready.catch(() => null);
  if (!reg) { btn.hidden = true; return; }

  let sub = await reg.pushManager.getSubscription().catch(() => null);
  setBtn(btn, sub ? "on" : "off", sub ? "🔔 Rappels activés (cliquer pour désactiver)" : "🔔 Recevoir les rappels d'émission");

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      sub = await reg.pushManager.getSubscription().catch(() => null);
      if (sub) {
        // Désabonnement.
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        await fetch(`${API_BASE}/v1/push/unsubscribe`, {
          method: "POST", mode: "cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
        setBtn(btn, "off", "🔔 Recevoir les rappels d'émission");
        return;
      }

      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setBtn(btn, "off", "🔔 Recevoir les rappels d'émission");
        return;
      }

      const newSub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(serverKey),
      });
      const json = newSub.toJSON();
      await fetch(`${API_BASE}/v1/push/subscribe`, {
        method: "POST", mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: newSub.endpoint,
          keys: json.keys,
          clientId: ensureClientId(),
          showSlug: null, // tous les rappels
        }),
      });
      setBtn(btn, "on", "🔔 Rappels activés (cliquer pour désactiver)");
    } catch {
      setBtn(btn, "off", "🔔 Recevoir les rappels d'émission");
    }
  });
}
