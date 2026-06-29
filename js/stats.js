/* Stats d'écoute locales (jamais transmises). */

import { $, escapeHtml, safeAnimate, prefersReducedMotion, EASE_OUT } from "./util.js";
import { store, STORAGE } from "./store.js";
import { getCurrentSlot } from "./schedule.js";
import { getAudio } from "./player.js";
import { toast } from "./toast.js";

const stats = {
  load() {
    return store.getJSON(STORAGE.stats, {
      totalSec: 0, sessions: 0, perShow: {}, perDay: {}, firstSession: null, lastSession: null,
    });
  },
  save(s) { store.setJSON(STORAGE.stats, s); },
  reset() {
    store.setJSON(STORAGE.stats, {
      totalSec: 0, sessions: 0, perShow: {}, perDay: {}, firstSession: null, lastSession: null,
    });
  },
};

let statsTickId = 0;
let statsLastTick = 0;

export function startStatsTracking() {
  if (statsTickId) return;
  const s = stats.load();
  s.sessions += 1;
  if (!s.firstSession) s.firstSession = new Date().toISOString();
  s.lastSession = new Date().toISOString();
  stats.save(s);
  statsLastTick = Date.now();
  statsTickId = window.setInterval(() => {
    const audio = getAudio();
    if (audio?.paused || audio?.muted) { statsLastTick = Date.now(); return; }
    const now = Date.now();
    const delta = Math.min(30, Math.floor((now - statsLastTick) / 1000));
    if (delta <= 0) return;
    statsLastTick = now;
    const cur = stats.load();
    cur.totalSec += delta;
    const slot = getCurrentSlot();
    if (slot) cur.perShow[slot.title] = (cur.perShow[slot.title] || 0) + delta;
    const dayKey = new Date().toISOString().slice(0, 10);
    cur.perDay[dayKey] = (cur.perDay[dayKey] || 0) + delta;
    cur.lastSession = new Date().toISOString();
    stats.save(cur);
  }, 5000);
}

function formatDuration(sec) {
  if (sec < 60) return `${sec} s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2,"0")}`;
}

export function renderStatsPage() {
  const root = $("#statsRoot");
  if (!root) return;
  const s = stats.load();
  const topShows = Object.entries(s.perShow).sort((a,b) => b[1] - a[1]).slice(0, 8);
  const topDays = Object.entries(s.perDay).sort((a,b) => b[0] < a[0] ? 1 : -1).slice(0, 14);
  const maxShow = topShows[0]?.[1] || 1;
  const maxDay = Math.max(...topDays.map(([,v]) => v), 1);
  root.innerHTML = `
    <div class="stats-summary">
      <div class="stat-card"><small>Temps total</small><strong>${formatDuration(s.totalSec)}</strong></div>
      <div class="stat-card"><small>Sessions</small><strong>${s.sessions}</strong></div>
      <div class="stat-card"><small>Premier passage</small><strong>${s.firstSession ? new Date(s.firstSession).toLocaleDateString("fr-CA") : "—"}</strong></div>
      <div class="stat-card"><small>Dernière écoute</small><strong>${s.lastSession ? new Date(s.lastSession).toLocaleDateString("fr-CA") : "—"}</strong></div>
    </div>
    <h2>Top émissions écoutées</h2>
    ${topShows.length ? `<ul class="stats-bars">${topShows.map(([t, v]) => `
      <li><span class="bar-label">${escapeHtml(t)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(v/maxShow*100).toFixed(1)}%"></span></span>
      <span class="bar-value">${formatDuration(v)}</span></li>`).join("")}</ul>` : `<p class="stats-empty">Aucune écoute enregistrée pour l'instant.</p>`}
    <h2>14 derniers jours</h2>
    ${topDays.length ? `<ul class="stats-bars stats-days">${topDays.map(([d, v]) => `
      <li><span class="bar-label">${d}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(v/maxDay*100).toFixed(1)}%"></span></span>
      <span class="bar-value">${formatDuration(v)}</span></li>`).join("")}</ul>` : ``}
    <div class="stats-actions">
      <button type="button" id="exportStats" class="btn btn-soft">Exporter (.json)</button>
      <button type="button" id="resetStats" class="btn btn-ghost">Réinitialiser</button>
    </div>`;

  // Polish (CSS-free) : cascade d'apparition des cartes + count-up des 2 KPIs.
  animateStatsCards(root, s);

  $("#exportStats")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `hitradio-stats-${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  });
  $("#resetStats")?.addEventListener("click", () => {
    if (confirm("Réinitialiser toutes les statistiques ?")) {
      stats.reset(); renderStatsPage(); toast("Statistiques réinitialisées.", "info");
    }
  });
}

/* Apparition en cascade des 4 cartes + comptage animé des 2 KPIs chiffrés. */
function animateStatsCards(root, s) {
  const cards = root.querySelectorAll(".stat-card");
  cards.forEach((el, i) => safeAnimate(el, [
    { opacity: 0, transform: "translateY(8px)" },
    { opacity: 1, transform: "translateY(0)" },
  ], { duration: 520, delay: i * 90, easing: EASE_OUT, fill: "both" }));
  if (prefersReducedMotion()) return;
  // Carte 1 = Temps total (formaté), carte 2 = Sessions (entier) — jamais les dates.
  const strongs = root.querySelectorAll(".stat-card strong");
  countUp(strongs[0], s.totalSec, (v) => formatDuration(Math.round(v)));
  countUp(strongs[1], s.sessions, (v) => String(Math.round(v)));
}

/* Incrémente le texte d'un élément de 0 à `target` (rAF), format préservé. */
function countUp(el, target, fmt) {
  if (!el || typeof target !== "number" || target <= 0) return;
  const duration = 900;
  let startTs = 0;
  el.textContent = fmt(0);
  const step = (ts) => {
    if (!startTs) startTs = ts;
    const p = Math.min(1, (ts - startTs) / duration);
    const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
    el.textContent = fmt(target * eased);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = fmt(target);
  };
  requestAnimationFrame(step);
}
