/* Favoris animateurs / shows (filtre "Mes favoris"). */

import { $$ } from "./util.js";
import { store, STORAGE } from "./store.js";
import { toast } from "./toast.js";

function getFavs() { return new Set(store.getJSON(STORAGE.favs, [])); }
function setFavs(set) { store.setJSON(STORAGE.favs, [...set]); }

function toggleFav(key, label) {
  const favs = getFavs();
  if (favs.has(key)) { favs.delete(key); toast(`Retiré des favoris : ${label}`, "info"); }
  else { favs.add(key); toast(`Ajouté aux favoris : ${label} ♥`, "ok"); }
  setFavs(favs);
  syncFavButtons();
  applyFavFilter();
}

function syncFavButtons() {
  const favs = getFavs();
  $$(".fav-btn").forEach((b) => {
    const on = favs.has(b.dataset.favKey);
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", on ? "Retirer des favoris" : "Ajouter aux favoris");
  });
}

const HEART_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;

export function injectFavButtons() {
  $$(".talent-card").forEach((card) => {
    if (card.querySelector(".fav-btn")) return;
    const name = card.querySelector("p")?.textContent?.trim();
    if (!name) return;
    const key = "talent:" + name.toLowerCase();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fav-btn";
    btn.dataset.favKey = key;
    btn.dataset.favLabel = name;
    btn.innerHTML = HEART_SVG;
    btn.addEventListener("click", (e) => { e.stopPropagation(); toggleFav(key, name); });
    card.appendChild(btn);
  });
  $$(".show-detail").forEach((card) => {
    if (card.querySelector(".fav-btn")) return;
    const title = card.querySelector("h3")?.textContent?.trim();
    if (!title) return;
    const key = "show:" + title.toLowerCase();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fav-btn";
    btn.dataset.favKey = key;
    btn.dataset.favLabel = title;
    btn.innerHTML = HEART_SVG;
    btn.addEventListener("click", (e) => { e.stopPropagation(); toggleFav(key, title); });
    card.appendChild(btn);
  });
  syncFavButtons();
}

export function injectFavFilter() {
  const containers = $$(".talent-grid, .show-detail-grid");
  containers.forEach((grid) => {
    const parent = grid.parentElement;
    if (!parent || parent.querySelector(".fav-filter-bar")) return;
    const bar = document.createElement("div");
    bar.className = "fav-filter-bar";
    bar.innerHTML = `
      <button type="button" class="fav-filter is-active" data-filter="all">Tout afficher</button>
      <button type="button" class="fav-filter" data-filter="favs">♥ Mes favoris <span class="fav-count" data-fav-count></span></button>`;
    parent.insertBefore(bar, grid);
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-filter]");
      if (!b) return;
      $$(".fav-filter", bar).forEach((x) => x.classList.toggle("is-active", x === b));
      grid.dataset.filter = b.dataset.filter;
      applyFavFilter();
    });
  });
  applyFavFilter();
}

function applyFavFilter() {
  const favs = getFavs();
  $$("[data-fav-count]").forEach((el) => { el.textContent = favs.size ? `(${favs.size})` : ""; });
  $$(".talent-grid, .show-detail-grid").forEach((grid) => {
    const mode = grid.dataset.filter || "all";
    $$(".talent-card, .show-detail", grid).forEach((card) => {
      const key = card.querySelector(".fav-btn")?.dataset.favKey;
      const show = mode === "all" || (key && favs.has(key));
      card.style.display = show ? "" : "none";
    });
  });
}
