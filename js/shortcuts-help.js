/* Cheat-sheet raccourcis (touche ?). */

import { $ } from "./util.js";
import { activateModalTrap } from "./a11y-modal.js";

const SHORTCUTS = [
  ["Espace", "Lecture / Pause"],
  ["M", "Couper le son"],
  ["↑ / ↓", "Volume"],
  ["Ctrl + K", "Recherche rapide"],
  ["L", "Paroles synchronisées"],
  ["W", "Mode plein écran"],
  ["P", "Picture-in-Picture"],
  ["H", "Historique"],
  ["?", "Cette aide"],
  ["Échap", "Fermer un panneau"],
];

let _releaseTrap = null;
let _previousFocus = null;

function ensureShortcutsPanel() {
  if ($("#shortcutsPanel")) return;
  const p = document.createElement("div");
  p.id = "shortcutsPanel";
  p.className = "shortcuts-panel";
  p.hidden = true;
  p.setAttribute("role", "dialog");
  p.setAttribute("aria-modal", "true");
  p.setAttribute("aria-label", "Raccourcis clavier");
  p.innerHTML = `
    <div class="shortcuts-card">
      <header><strong>⌨ Raccourcis clavier</strong><button type="button" class="shortcuts-close" aria-label="Fermer">×</button></header>
      <table>
        <caption class="sr-only">Liste des raccourcis clavier disponibles sur le site</caption>
        <tbody>
          ${SHORTCUTS.map(([k, d]) => `<tr><td><kbd>${k}</kbd></td><td>${d}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  document.body.appendChild(p);
  p.addEventListener("click", (e) => { if (e.target === p) toggleShortcuts(false); });
  p.querySelector(".shortcuts-close").addEventListener("click", () => toggleShortcuts(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !p.hidden) toggleShortcuts(false);
  });
}

export function toggleShortcuts(force) {
  ensureShortcutsPanel();
  const p = $("#shortcutsPanel");
  const open = typeof force === "boolean" ? force : p.hidden;
  if (open) {
    _previousFocus = document.activeElement;
    p.hidden = false;
    _releaseTrap?.();
    _releaseTrap = activateModalTrap(p, {
      closeBtn: p.querySelector(".shortcuts-close"),
      previousFocus: _previousFocus,
    });
  } else {
    if (_releaseTrap) {
      _releaseTrap();
      _releaseTrap = null;
      _previousFocus = null;
    }
    p.hidden = true;
  }
}
