/* Installation PWA : beforeinstallprompt + sheet manuel iOS/Android.
   Branche tous les boutons .install-pwa-btn via délégation (zéro onclick inline). */

import { $$ } from "./util.js";
import { toast } from "./toast.js";

let deferredInstallPrompt = null;
const ua = navigator.userAgent || "";
const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
const isAndroid = /Android/i.test(ua);
const isBrave = (navigator.brave && typeof navigator.brave.isBrave === "function") || /Brave/i.test(ua);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

function showInstallButtons() {
  $$("#installPwaBtn, .install-pwa-btn").forEach((b) => b.classList.add("is-available"));
}
function hideInstallButtons() {
  $$("#installPwaBtn, .install-pwa-btn").forEach((b) => b.classList.remove("is-available"));
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallButtons();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  hideInstallButtons();
  toast("Hits Dance Music installé sur ton appareil ! 🎉", "ok");
});

export async function triggerInstall() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    try { await deferredInstallPrompt.userChoice; } catch { /* noop */ }
    deferredInstallPrompt = null;
    return;
  }
  if (isStandalone) {
    toast("L'app est déjà installée sur cet appareil ✅", "ok");
    return;
  }
  if (isIOS) { showInstallSheet("ios", isBrave); return; }
  if (isAndroid) { showInstallSheet("android", isBrave); return; }
  showInstallSheet("desktop", false);
}

function showInstallSheet(platform, brave) {
  const existing = document.getElementById("installSheet");
  if (existing) existing.remove();

  const title = "Installer Hits Dance Music";
  let body = "";

  if (platform === "ios" && brave) {
    body = `
      <p class="install-sheet-warn">⚠️ Brave sur iPhone ne permet pas l'install directe (limitation Apple).</p>
      <ol>
        <li>Touche <strong>Partager</strong> en bas de l'écran, puis <strong>« Ouvrir avec Safari »</strong>.</li>
        <li>Dans Safari, touche à nouveau <strong>Partager</strong>.</li>
        <li>Choisis <strong>« Sur l'écran d'accueil »</strong>, puis <strong>Ajouter</strong>. 🎉</li>
      </ol>`;
  } else if (platform === "ios") {
    body = `
      <ol>
        <li>Touche le bouton <strong>Partager</strong>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M20 16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/></svg>
          dans la barre Safari.
        </li>
        <li>Fais défiler puis choisis <strong>« Sur l'écran d'accueil »</strong>.</li>
        <li>Confirme avec <strong>Ajouter</strong>. C'est fait 🎉</li>
      </ol>`;
  } else if (platform === "android" && brave) {
    body = `
      <p class="install-sheet-warn">💡 Astuce Brave : si l'install est bloquée, désactive les <strong>Shields</strong> pour ce site (touche le 🦁 dans la barre).</p>
      <ol>
        <li>Touche le menu <strong>⋮</strong> en haut à droite de Brave.</li>
        <li>Choisis <strong>« Ajouter à l'écran d'accueil »</strong> ou <strong>« Installer l'application »</strong>.</li>
        <li>Confirme. L'icône Hits Dance Music apparaît sur ton écran d'accueil 🎉</li>
      </ol>`;
  } else if (platform === "android") {
    body = `
      <ol>
        <li>Touche le menu <strong>⋮</strong> de ton navigateur.</li>
        <li>Choisis <strong>« Installer l'application »</strong> ou <strong>« Ajouter à l'écran d'accueil »</strong>.</li>
        <li>Confirme l'installation. 🎉</li>
      </ol>`;
  } else {
    body = `
      <ol>
        <li>Dans la barre d'adresse, cherche l'icône <strong>⊕</strong> ou <strong>⬇️</strong> à droite.</li>
        <li>Clique puis confirme <strong>« Installer »</strong>.</li>
        <li>Hits Dance Music s'ouvre comme une vraie app. 🎉</li>
      </ol>`;
  }

  const sheet = document.createElement("div");
  sheet.id = "installSheet";
  sheet.className = "ios-install-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", title);
  sheet.innerHTML = `
    <div class="ios-install-card">
      <button type="button" class="ios-install-close" aria-label="Fermer">×</button>
      <h3>${title}</h3>
      ${body}
    </div>
  `;
  document.body.appendChild(sheet);
  const close = () => sheet.remove();
  sheet.querySelector(".ios-install-close").addEventListener("click", close);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
  });
}

export function wireInstallButtons() {
  if (isStandalone) hideInstallButtons(); else showInstallButtons();
  document.querySelectorAll(".install-pwa-btn").forEach((btn) => {
    if (btn.dataset.installBound === "1") return;
    btn.dataset.installBound = "1";
    btn.addEventListener("click", (e) => { e.preventDefault(); void triggerInstall(); });
  });
}
