/* Cheat-sheet raccourcis (touche ?). */

import { $ } from "./util.js";

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

function ensureShortcutsPanel() {
  if ($("#shortcutsPanel")) return;
  const p = document.createElement("div");
  p.id = "shortcutsPanel";
  p.className = "shortcuts-panel";
  p.hidden = true;
  p.innerHTML = `
    <div class="shortcuts-card">
      <header><strong>⌨ Raccourcis clavier</strong><button type="button" class="shortcuts-close" aria-label="Fermer">×</button></header>
      <table>
        <tbody>
          ${SHORTCUTS.map(([k, d]) => `<tr><td><kbd>${k}</kbd></td><td>${d}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  document.body.appendChild(p);
  p.addEventListener("click", (e) => { if (e.target === p) toggleShortcuts(); });
  p.querySelector(".shortcuts-close").addEventListener("click", toggleShortcuts);
}

export function toggleShortcuts() {
  ensureShortcutsPanel();
  const p = $("#shortcutsPanel");
  p.hidden = !p.hidden;
}
