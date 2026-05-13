/* Enregistrement du Service Worker (PWA shell) + écoute des mises à jour. */

import { toast } from "./toast.js";

export function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW", err));
  });

  // Notification de mise à jour : le SW envoie un message via BroadcastChannel
  // dès qu'il active une nouvelle version. On affiche un toast non-bloquant.
  // L'utilisateur recharge quand il veut (pas de redémarrage forcé).
  if ("BroadcastChannel" in window) {
    try {
      const ch = new BroadcastChannel("hitradio-sw");
      let shown = false;
      ch.addEventListener("message", (e) => {
        if (shown || !e.data || e.data.type !== "updated") return;
        shown = true;
        toast("Nouvelle version disponible — recharge pour l'appliquer.", "info", 8000);
      });
    } catch { /* noop */ }
  }
}
