/* Accessibilité : région ARIA live globale + helper focus trap + skip-link. */

import { $ } from "./util.js";

export function ensureLiveRegion() {
  if ($("#hr-live")) return;
  const live = document.createElement("div");
  live.id = "hr-live";
  live.className = "sr-only";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  document.body.appendChild(live);
}

export function announce(msg) {
  ensureLiveRegion();
  const live = $("#hr-live");
  live.textContent = "";
  setTimeout(() => { live.textContent = msg; }, 50);
}

export function trapFocus(container) {
  if (!container) return () => {};
  const focusables = container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
  if (!focusables.length) return () => {};
  const first = focusables[0], last = focusables[focusables.length - 1];
  const handler = (e) => {
    if (e.key !== "Tab") return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  container.addEventListener("keydown", handler);
  return () => container.removeEventListener("keydown", handler);
}

export function ensureSkipLink() {
  if (document.querySelector(".skip-link")) return;
  const main = document.querySelector("main");
  if (main && !main.id) main.id = "main";
  const targetId = (main?.id) || "main";
  const skip = document.createElement("a");
  skip.className = "skip-link";
  skip.href = `#${targetId}`;
  skip.textContent = "Aller au contenu";
  document.body.insertBefore(skip, document.body.firstChild);
  if (main) main.setAttribute("tabindex", "-1");
}
