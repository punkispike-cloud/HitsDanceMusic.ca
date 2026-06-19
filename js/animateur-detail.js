/* Fiche animateur détaillée : ouverte au clic sur une carte .talent-card.
   Récupère les données précises via /v1/artists/:slug (émissions + prochains
   passages calculés côté serveur sur les VRAIES FK), avec repli sur l'objet
   animateur déjà en mémoire si l'API échoue. */

import { escapeHtml } from "./util.js";
import { API_BASE } from "./api-config.js";
import { SLOT_TAGS } from "./schedule.js";
import { DAY_NAMES } from "./time.js";

const SOCIAL_LABELS = [
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["tiktok", "TikTok"],
  ["youtube", "YouTube"],
  ["website", "Site web"],
];

function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

function tagColor(tag) {
  return (SLOT_TAGS[tag] || SLOT_TAGS.hitlist).color;
}

let _overlay = null;
let _lastFocus = null;

function close() {
  if (!_overlay) return;
  const ov = _overlay;
  _overlay = null;
  ov.classList.remove("is-open");
  setTimeout(() => ov.remove(), 200);
  document.removeEventListener("keydown", onKey);
  if (_lastFocus && _lastFocus.focus) _lastFocus.focus();
}

function onKey(e) {
  if (e.key === "Escape") close();
}

function render(detail) {
  const photo = detail.photoUrl
    ? `<img src="${escapeHtml(detail.photoUrl)}" alt="${escapeHtml(detail.name)}" />`
    : escapeHtml(detail.initials || (detail.name || "?").slice(0, 2));

  const s = detail.socials || {};
  const socialLinks = SOCIAL_LABELS
    .map(([k, label]) => [safeUrl(s[k]), label])
    .filter(([u]) => u)
    .map(([u, label]) =>
      `<a class="adetail-social" href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`);
  const socials = socialLinks.length ? `<div class="adetail-socials">${socialLinks.join("")}</div>` : "";

  const myShows = Array.isArray(detail.shows) ? detail.shows : [];
  const showsHtml = myShows.length
    ? `<ul class="adetail-list">${myShows
        .map((sh) => `<li style="--li-accent:${tagColor(sh.tag)}"><span class="li-title">${escapeHtml(sh.title)}</span></li>`)
        .join("")}</ul>`
    : `<p class="adetail-empty">Aucune émission liée pour l'instant.</p>`;

  const upcoming = Array.isArray(detail.upcoming) ? detail.upcoming : [];
  const upcomingHtml = upcoming.length
    ? `<ul class="adetail-list">${upcoming
        .map((u) =>
          `<li style="--li-accent:${tagColor(u.tag)}"><span class="li-time">${DAY_NAMES[u.day]} ${escapeHtml(u.from)}</span><span class="li-title">${escapeHtml(u.title)}</span></li>`)
        .join("")}</ul>`
    : `<p class="adetail-empty">Aucun passage planifié cette semaine.</p>`;

  return `
    <div class="adetail" role="dialog" aria-modal="true" aria-label="Profil de ${escapeHtml(detail.name)}">
      <button class="adetail-close" aria-label="Fermer" title="Fermer">×</button>
      <div class="adetail-head">
        <div class="adetail-photo">${photo}</div>
        <div>
          <h2>${escapeHtml(detail.name)}</h2>
          ${detail.showTitle ? `<p class="adetail-show">${escapeHtml(detail.showTitle)}</p>` : ""}
          ${detail.scheduleText ? `<p class="adetail-sched">${escapeHtml(detail.scheduleText)}</p>` : ""}
        </div>
      </div>
      ${detail.bio ? `<p class="adetail-bio">${escapeHtml(detail.bio)}</p>` : ""}
      ${socials}
      <div class="adetail-section"><h3>Émissions</h3>${showsHtml}</div>
      <div class="adetail-section"><h3>Prochains passages</h3>${upcomingHtml}</div>
    </div>`;
}

function mount(detail) {
  if (_overlay) close();
  _lastFocus = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "adetail-overlay";
  overlay.innerHTML = render(detail);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".adetail-close").addEventListener("click", close);
  document.body.appendChild(overlay);
  _overlay = overlay;
  requestAnimationFrame(() => overlay.classList.add("is-open"));
  document.addEventListener("keydown", onKey);
  overlay.querySelector(".adetail-close")?.focus();
}

/* Ouvre la fiche par slug. fallback = objet animateur déjà en mémoire (rendu
   immédiat si l'API tarde / échoue). */
export async function openAnimateurDetail(slug, fallback) {
  if (fallback) mount({ ...fallback, shows: [], upcoming: [] });
  if (!slug) return;
  try {
    const r = await fetch(`${API_BASE}/v1/artists/${encodeURIComponent(slug)}`, { mode: "cors" });
    if (!r.ok) return;
    const detail = await r.json();
    // Ne remplace que si la fiche est toujours ouverte sur le même animateur.
    if (_overlay) mount(detail);
  } catch {
    /* repli déjà affiché */
  }
}

/* Rend les cartes cliquables → fiche par slug (data-slug, pas d'index fragile). */
export function wireTalentCards(grid, artists) {
  if (!grid) return;
  const bySlug = new Map((artists || []).map((a) => [a.slug, a]));
  grid._hrArtists = bySlug;
  if (grid.dataset.detailWired === "1") return;
  grid.dataset.detailWired = "1";

  const openFrom = (card) => {
    const slug = card.dataset.slug;
    if (!slug) return;
    openAnimateurDetail(slug, grid._hrArtists.get(slug));
  };
  grid.addEventListener("click", (e) => {
    if (e.target.closest("a")) return; // laisse les liens sociaux fonctionner
    const card = e.target.closest(".talent-card");
    if (card && grid.contains(card)) openFrom(card);
  });
  grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".talent-card");
    if (card) { e.preventDefault(); openFrom(card); }
  });
}
