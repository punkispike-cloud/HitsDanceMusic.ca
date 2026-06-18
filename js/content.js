/* Branche les cartes ANIMATEURS et ÉMISSIONS du site sur l'API (éditables
   depuis l'admin). Re-rend les mêmes structures HTML/classes → visuel
   identique. Fallback : si l'API ne répond pas, le HTML statique reste.
   - index.html       : .talent-grid (sous-ensemble = nb de cartes d'origine)
   - animateurs.html  : .talent-grid.extended (tous)
   - emissions.html   : .show-detail-grid (toutes) */

import { escapeHtml } from "./util.js";
import { API_BASE } from "./api-config.js";

async function fetchJson(path) {
  try {
    const r = await fetch(`${API_BASE}${path}`, { mode: "cors", cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/* N'autorise que les URLs http(s) (évite javascript: et autres schémas). */
function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

const SOCIAL_LABELS = [
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["tiktok", "TikTok"],
  ["youtube", "YouTube"],
  ["website", "Site"],
];

function socialsHtml(socials) {
  if (!socials || typeof socials !== "object") return "";
  const links = SOCIAL_LABELS
    .map(([k, label]) => [safeUrl(socials[k]), label])
    .filter(([url]) => url)
    .map(([url, label]) =>
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="font-size:.78rem;font-weight:700;color:#e8b84b;text-decoration:none">${label}</a>`);
  if (!links.length) return "";
  return `<p class="talent-socials" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;justify-content:center">${links.join("")}</p>`;
}

function talentCardHtml(a) {
  const photo = a.photoUrl && safeUrl(a.photoUrl) ? a.photoUrl
    : (a.photoUrl && !/^https?:/i.test(a.photoUrl) ? a.photoUrl : null); // chemins relatifs (assets/...) ok
  const avatar = photo
    ? `<div class="avatar has-photo"><img src="${escapeHtml(photo)}" alt="${escapeHtml(a.name)}" loading="lazy" /></div>`
    : `<div class="avatar">${escapeHtml(a.initials || a.name.slice(0, 2))}</div>`;
  return `<article class="talent-card">
      ${avatar}
      <p>${escapeHtml(a.name)}</p>
      ${a.showTitle ? `<strong>${escapeHtml(a.showTitle)}</strong>` : ""}
      ${a.scheduleText ? `<span>${escapeHtml(a.scheduleText)}</span>` : ""}
      ${a.bio ? `<small>${escapeHtml(a.bio)}</small>` : ""}
      ${socialsHtml(a.socials)}
    </article>`;
}

function showCardHtml(s, nameById) {
  const meta = s.artistId && nameById.get(s.artistId) ? nameById.get(s.artistId) : "Programmation";
  return `<article class="show-detail">
      ${s.badge ? `<span class="badge">${escapeHtml(s.badge)}</span>` : ""}
      <h3>${escapeHtml(s.title)}</h3>
      ${s.description ? `<p>${escapeHtml(s.description)}</p>` : ""}
      <span class="meta">${escapeHtml(meta)}</span>
      ${s.scheduleText ? `<span class="next"><strong>${escapeHtml(s.scheduleText)}</strong></span>` : ""}
    </article>`;
}

/* Re-rend les cartes présentes sur la page. Retourne true si une grille a été
   mise à jour (→ ré-annoter les cartes animateurs ensuite). */
export async function loadContentFromApi() {
  const talentGrid = document.querySelector(".talent-grid");
  const showGrid = document.querySelector(".show-detail-grid");
  if (!talentGrid && !showGrid) return false;

  const [artists, shows] = await Promise.all([
    talentGrid || showGrid ? fetchJson("/v1/artists") : null,
    showGrid ? fetchJson("/v1/shows") : null,
  ]);

  let touchedTalent = false;
  if (talentGrid && Array.isArray(artists) && artists.length) {
    // index.html (grille non "extended") : garde le nombre de cartes d'origine.
    const isExtended = talentGrid.classList.contains("extended");
    const origin = talentGrid.querySelectorAll(".talent-card").length || artists.length;
    const list = isExtended ? artists : artists.slice(0, origin);
    talentGrid.innerHTML = list.map(talentCardHtml).join("");
    touchedTalent = true;
  }

  if (showGrid && Array.isArray(shows) && shows.length) {
    const nameById = new Map((Array.isArray(artists) ? artists : []).map((a) => [a.id, a.name]));
    showGrid.innerHTML = shows.map((s) => showCardHtml(s, nameById)).join("");
  }

  return touchedTalent;
}
