/* Fiche animateur détaillée : ouverte au clic sur une carte .talent-card.
   Affiche grande photo, bio, réseaux sociaux, ses émissions et ses prochains
   passages (calculés depuis la grille en mémoire). */

import { escapeHtml } from "./util.js";
import { SCHEDULE, SLOT_TAGS } from "./schedule.js";
import { getMontrealParts, toMinutes, DAY_NAMES } from "./time.js";

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

const norm = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/* Jetons significatifs (≥4 lettres) du nom + titre d'émission de l'animateur. */
function artistTokens(artist) {
  const src = `${artist.name || ""} ${artist.showTitle || ""}`;
  return [...new Set(norm(src).split(/[^a-z0-9]+/).filter((t) => t.length >= 4))];
}

/* Prochains créneaux de la semaine correspondant à l'animateur (heuristique
   par jetons sur host + titre). Max 6. */
function upcomingForArtist(artist) {
  const tokens = artistTokens(artist);
  if (!tokens.length) return [];
  const { day, hour, minute } = getMontrealParts();
  const nowMin = hour * 60 + minute;
  const out = [];
  for (let off = 0; off < 7 && out.length < 6; off++) {
    const d = (day + off) % 7;
    for (const [from, to, title, host, tag] of SCHEDULE[d] || []) {
      const hay = norm(`${host} ${title}`);
      if (!tokens.some((t) => hay.includes(t))) continue;
      const fromMin = toMinutes(from);
      if (off === 0 && fromMin <= nowMin) continue;
      out.push({ from, to: to === "24:00" ? "00:00" : to, title, tag, day: d });
      if (out.length >= 6) break;
    }
  }
  return out;
}

let _overlay = null;
let _lastFocus = null;

function close() {
  if (!_overlay) return;
  _overlay.classList.remove("is-open");
  const ov = _overlay;
  _overlay = null;
  setTimeout(() => ov.remove(), 200);
  document.removeEventListener("keydown", onKey);
  if (_lastFocus && _lastFocus.focus) _lastFocus.focus();
}

function onKey(e) {
  if (e.key === "Escape") close();
}

export function openAnimateurDetail(artist, shows = []) {
  if (_overlay) close();
  _lastFocus = document.activeElement;

  const photo = artist.photoUrl
    ? `<img src="${escapeHtml(artist.photoUrl)}" alt="${escapeHtml(artist.name)}" />`
    : escapeHtml(artist.initials || (artist.name || "?").slice(0, 2));

  const socials = (() => {
    const s = artist.socials || {};
    const links = SOCIAL_LABELS
      .map(([k, label]) => [safeUrl(s[k]), label])
      .filter(([u]) => u)
      .map(([u, label]) =>
        `<a class="adetail-social" href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`);
    return links.length ? `<div class="adetail-socials">${links.join("")}</div>` : "";
  })();

  const myShows = shows.filter((sh) => sh.artistId && sh.artistId === artist.id);
  const showsHtml = myShows.length
    ? `<ul class="adetail-list">${myShows
        .map((sh) => {
          const c = (SLOT_TAGS[sh.tag] || SLOT_TAGS.hitlist).color;
          return `<li style="--li-accent:${c}"><span class="li-title">${escapeHtml(sh.title)}</span></li>`;
        })
        .join("")}</ul>`
    : `<p class="adetail-empty">Aucune émission liée pour l'instant.</p>`;

  const upcoming = upcomingForArtist(artist);
  const upcomingHtml = upcoming.length
    ? `<ul class="adetail-list">${upcoming
        .map((u) => {
          const c = (SLOT_TAGS[u.tag] || SLOT_TAGS.hitlist).color;
          return `<li style="--li-accent:${c}"><span class="li-time">${DAY_NAMES[u.day]} ${u.from}</span><span class="li-title">${escapeHtml(u.title)}</span></li>`;
        })
        .join("")}</ul>`
    : `<p class="adetail-empty">Aucun passage planifié cette semaine.</p>`;

  const overlay = document.createElement("div");
  overlay.className = "adetail-overlay";
  overlay.innerHTML = `
    <div class="adetail" role="dialog" aria-modal="true" aria-label="Profil de ${escapeHtml(artist.name)}">
      <button class="adetail-close" aria-label="Fermer" title="Fermer">×</button>
      <div class="adetail-head">
        <div class="adetail-photo">${photo}</div>
        <div>
          <h2>${escapeHtml(artist.name)}</h2>
          ${artist.showTitle ? `<p class="adetail-show">${escapeHtml(artist.showTitle)}</p>` : ""}
          ${artist.scheduleText ? `<p class="adetail-sched">${escapeHtml(artist.scheduleText)}</p>` : ""}
        </div>
      </div>
      ${artist.bio ? `<p class="adetail-bio">${escapeHtml(artist.bio)}</p>` : ""}
      ${socials}
      <div class="adetail-section"><h3>Émissions</h3>${showsHtml}</div>
      <div class="adetail-section"><h3>Prochains passages</h3>${upcomingHtml}</div>
    </div>`;

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

/* Rend les cartes d'une grille cliquables → ouvre la fiche. Délégation sur la
   grille (les cartes sont re-rendues par content.js). */
export function wireTalentCards(grid, artists, shows) {
  if (!grid || grid.dataset.detailWired === "1") {
    if (grid) grid._hrDetailData = { artists, shows };
    return;
  }
  grid.dataset.detailWired = "1";
  grid._hrDetailData = { artists, shows };

  // Index par position : chaque .talent-card correspond à l'artiste de même rang.
  const open = (card) => {
    const cards = Array.from(grid.querySelectorAll(".talent-card"));
    const idx = cards.indexOf(card);
    const data = grid._hrDetailData || { artists: [], shows: [] };
    const artist = data.artists[idx];
    if (artist) openAnimateurDetail(artist, data.shows);
  };

  grid.addEventListener("click", (e) => {
    // Laisse les liens (réseaux sociaux) fonctionner sans ouvrir la fiche.
    if (e.target.closest("a")) return;
    const card = e.target.closest(".talent-card");
    if (card && grid.contains(card)) open(card);
  });
  grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".talent-card");
    if (card) { e.preventDefault(); open(card); }
  });
}
