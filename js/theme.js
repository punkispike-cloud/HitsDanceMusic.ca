/* Thème — verrouillé en mode sombre.
   Le bootstrap initial (assets/theme-init.js) fige déjà data-theme="dark"
   avant le rendu ; ce module conserve l'API utilisée par main.js et la
   palette de recherche mais réapplique systématiquement le dark. */

import { $$ } from "./util.js";

const THEME_KEY = "hr.theme";

export function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = "dark";
  root.dataset.themeMode = "dark";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = "#0f0f12";
  $$(".theme-toggle").forEach((b) => {
    b.dataset.theme = "dark";
    b.setAttribute("aria-label", "Thème sombre");
    b.setAttribute("title", "Thème sombre");
  });
}

export function cycleTheme() {
  // Conservé pour compat API — l'app reste en sombre.
  applyTheme();
}

export function initThemeWatchers() {
  // Plus rien à observer : ni système, ni autres onglets ne peuvent basculer.
}

export { THEME_KEY };
