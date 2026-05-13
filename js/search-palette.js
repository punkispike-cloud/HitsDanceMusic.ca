/* Palette de recherche rapide (Ctrl+K). Pages / shows / animateurs / actions. */

import { $, $$, escapeHtml } from "./util.js";
import { startPlayback, pausePlayback, toggleMute } from "./player.js";
import { toggleSleepMenu } from "./sleep.js";
import { toggleHistory, exportHistory } from "./history-drawer.js";
import { shareCurrent } from "./share.js";
import { cycleTheme } from "./theme.js";
import { triggerInstall } from "./install-pwa.js";
import { downloadIcs } from "./schedule.js";

// Hooks lazy (notifs, watch, lyrics, pip) injectés depuis main.js
let _toggleNotif = () => {};
let _openWatch = () => {};
let _toggleLyrics = () => {};
let _togglePip = () => {};
export function setSearchHooks(h) {
  if (h.toggleNotif)  _toggleNotif  = h.toggleNotif;
  if (h.openWatch)    _openWatch    = h.openWatch;
  if (h.toggleLyrics) _toggleLyrics = h.toggleLyrics;
  if (h.togglePip)    _togglePip    = h.togglePip;
}

const SEARCH_INDEX = [
  { type: "page", label: "Accueil", url: "index.html" },
  { type: "page", label: "DJs & animateurs", url: "animateurs.html" },
  { type: "page", label: "Émissions", url: "emissions.html" },
  { type: "page", label: "Horaire complet 2026", url: "horaire.html" },
  { type: "page", label: "Contact studio", url: "contact.html" },
  { type: "team", label: "Alain Perron — Les matins d'Alain", url: "animateurs.html" },
  { type: "team", label: "DJ Pierre Jutras — Hommage Limelight", url: "animateurs.html" },
  { type: "team", label: "DJ JÜMPOFF — JÜMPOFFproject (mix club)", url: "animateurs.html" },
  { type: "team", label: "DJ OSKANA — Show mix européen", url: "animateurs.html" },
  { type: "team", label: "Pee Jee — Pee Jee Radio Show", url: "animateurs.html" },
  { type: "show", label: "Les matins d'Alain (live)", url: "emissions.html" },
  { type: "show", label: "Hit List", url: "emissions.html" },
  { type: "show", label: "Le Hit Drive (live)", url: "emissions.html" },
  { type: "show", label: "Hommage au Limelight Montréal", url: "emissions.html" },
  { type: "show", label: "Nuits Best DJ's BeatRadioWorld", url: "emissions.html" },
  { type: "show", label: "Disco Fever Experience", url: "emissions.html" },
  { type: "show", label: "Latino Show", url: "emissions.html" },
  { type: "show", label: "Hot Slow Show", url: "emissions.html" },
  { type: "show", label: "Pee Jee Radio Show", url: "emissions.html" },
  { type: "show", label: "DJ OSKANA Show mix européen", url: "emissions.html" },
  { type: "action", label: "▶ Écouter le direct", action: () => startPlayback() },
  { type: "action", label: "⏸ Mettre en pause", action: () => pausePlayback() },
  { type: "action", label: "🔇 Couper le son", action: () => toggleMute() },
  { type: "action", label: "🌙 Minuteur de sommeil", action: () => toggleSleepMenu(document.body) },
  { type: "action", label: "🎵 Historique des morceaux", action: () => toggleHistory(true) },
  { type: "action", label: "📅 Télécharger la grille (.ics)", action: () => downloadIcs() },
  { type: "action", label: "🔗 Partager le direct", action: () => shareCurrent() },
  { type: "action", label: "🎨 Changer de thème", action: () => cycleTheme() },
  { type: "action", label: "📲 Installer l'app", action: () => triggerInstall() },
  { type: "action", label: "🔔 Activer/désactiver notifications", action: () => _toggleNotif() },
  { type: "action", label: "⛶ Mode plein écran", action: () => _openWatch() },
  { type: "action", label: "🎤 Paroles", action: () => _toggleLyrics() },
  { type: "action", label: "🗔 Picture-in-Picture", action: () => _togglePip() },
  { type: "action", label: "📊 Voir mes statistiques d'écoute", action: () => location.href = "stats.html" },
  { type: "action", label: "💾 Exporter l'historique (JSON)", action: () => exportHistory("json") },
  { type: "action", label: "💾 Exporter l'historique (CSV)", action: () => exportHistory("csv") },
  { type: "page", label: "Statistiques d'écoute", url: "stats.html" },
];
const TYPE_LABEL = { page: "Page", team: "Équipe", show: "Émission", action: "Action" };

function ensureSearchPalette() {
  if ($("#searchPalette")) return;
  const wrap = document.createElement("div");
  wrap.id = "searchPalette";
  wrap.className = "search-palette";
  wrap.hidden = true;
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("aria-label", "Recherche rapide");
  wrap.innerHTML = `
    <div class="search-backdrop" id="searchBackdrop"></div>
    <div class="search-box">
      <div class="search-input-wrap">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="searchInput" type="search" placeholder="Cherche un show, un DJ, une action…" autocomplete="off" />
        <kbd>Esc</kbd>
      </div>
      <ul id="searchResults" class="search-results" role="listbox"></ul>
      <p class="search-hint">↑↓ pour naviguer · ⏎ pour ouvrir · Ctrl+K pour rouvrir</p>
    </div>`;
  document.body.appendChild(wrap);
  const input = $("#searchInput", wrap);
  const list = $("#searchResults", wrap);
  $("#searchBackdrop", wrap).addEventListener("click", () => closeSearch());
  input.addEventListener("input", () => renderSearchResults(input.value));
  let activeIdx = 0;
  input.addEventListener("keydown", (e) => {
    const items = $$("li", list);
    if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = Math.min(items.length - 1, activeIdx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); }
    else if (e.key === "Enter") { e.preventDefault(); items[activeIdx]?.click(); return; }
    else if (e.key === "Escape") { closeSearch(); return; }
    items.forEach((it, i) => it.classList.toggle("is-active", i === activeIdx));
    items[activeIdx]?.scrollIntoView({ block: "nearest" });
  });
  list.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-idx]");
    if (!li) return;
    const item = SEARCH_INDEX[Number(li.dataset.idx)];
    closeSearch();
    if (item.action) item.action();
    else if (item.url) location.href = item.url;
  });
}

function renderSearchResults(q) {
  const list = $("#searchResults");
  if (!list) return;
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const query = norm(q.trim());
  const items = !query
    ? SEARCH_INDEX
    : SEARCH_INDEX.filter((it) => norm(it.label).includes(query));
  list.innerHTML = items.slice(0, 12).map((it) => {
    const idx = SEARCH_INDEX.indexOf(it);
    return `<li role="option" data-idx="${idx}" tabindex="-1">
      <span class="search-type search-type--${it.type}">${TYPE_LABEL[it.type]}</span>
      <span class="search-label">${escapeHtml(it.label)}</span>
    </li>`;
  }).join("") || `<li class="search-empty">Aucun résultat pour « ${escapeHtml(q)} »</li>`;
  list.firstElementChild?.classList.add("is-active");
}

export function openSearch() {
  ensureSearchPalette();
  const p = $("#searchPalette");
  p.hidden = false;
  requestAnimationFrame(() => p.classList.add("is-open"));
  const input = $("#searchInput");
  input.value = "";
  renderSearchResults("");
  setTimeout(() => input.focus(), 50);
}

export function closeSearch() {
  const p = $("#searchPalette");
  if (!p || p.hidden) return;
  p.classList.remove("is-open");
  setTimeout(() => { p.hidden = true; }, 200);
}
