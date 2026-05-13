/* Thème auto / clair / sombre. Persistance dans hr.theme.
   Le bootstrap initial est dans assets/theme-init.js (chargé tôt dans
   le <head> pour éviter le FOUC). Ce module gère le cycle utilisateur
   et la synchronisation système. */

import { $$ } from "./util.js";
import { store } from "./store.js";

const THEME_KEY = "hr.theme";
const _prefersLight = typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-color-scheme: light)")
  : null;

function resolveTheme(mode) {
  if (mode === "light" || mode === "dark") return mode;
  return _prefersLight && _prefersLight.matches ? "light" : "dark";
}

export function applyTheme(mode) {
  const root = document.documentElement;
  const resolved = resolveTheme(mode);
  root.dataset.theme = resolved;
  root.dataset.themeMode = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = (resolved === "light") ? "#fafafa" : "#0f0f12";
  $$(".theme-toggle").forEach((b) => {
    b.dataset.theme = mode;
    b.setAttribute("aria-label", `Thème : ${mode === "light" ? "clair" : mode === "dark" ? "sombre" : "auto (système)"}`);
    b.setAttribute("title", mode === "auto" ? `Auto · suit le système (actuellement ${resolved === "light" ? "clair" : "sombre"})` : `Thème ${mode === "light" ? "clair" : "sombre"}`);
  });
}

export function cycleTheme() {
  const cur = store.get(THEME_KEY, "auto");
  const next = cur === "auto" ? "dark" : cur === "dark" ? "light" : "auto";
  store.set(THEME_KEY, next);
  applyTheme(next);
}

export function initThemeWatchers() {
  // Suivre les changements système quand l'utilisateur a choisi "auto"
  if (_prefersLight && typeof _prefersLight.addEventListener === "function") {
    _prefersLight.addEventListener("change", () => {
      if (store.get(THEME_KEY, "auto") === "auto") applyTheme("auto");
    });
  }
  // Synchroniser entre onglets / fenêtres
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_KEY) applyTheme(e.newValue || "auto");
  });
}

export { THEME_KEY };
