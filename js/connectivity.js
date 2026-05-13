/* Banner offline. */

import { $ } from "./util.js";

export function bindConnectivity() {
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
