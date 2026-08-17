/* Section « À la une » homepage — alimentée par GET /v1/featured?kind=homepage.
   Repli sur le HTML statique si l'API ne répond pas. */

import { escapeHtml } from "./util.js";
import { API_BASE } from "./api-config.js";

function cardHtml(item) {
  const variant = item.variant ? ` featured-card--${escapeHtml(item.variant)}` : "";
  const cover = item.coverUrl
    ? `<div class="featured-cover"><img src="${escapeHtml(item.coverUrl)}" alt="" loading="lazy" /></div>`
    : "";
  const tag = item.tag ? `<span class="featured-tag">${escapeHtml(item.tag)}</span>` : "";
  const meta = item.meta ? `<p class="featured-meta">${escapeHtml(item.meta)}</p>` : "";
  const body = item.body ? `<p>${escapeHtml(item.body)}</p>` : "";
  const inner = `${cover}${tag}<h3>${escapeHtml(item.title)}</h3>${meta}${body}`;
  if (item.linkUrl) {
    return `<a class="featured-card${variant}" href="${escapeHtml(item.linkUrl)}">${inner}</a>`;
  }
  return `<article class="featured-card${variant}">${inner}</article>`;
}

export async function initFeaturedHomepage() {
  const grid = document.querySelector(".featured-grid");
  if (!grid) return;
  try {
    const r = await fetch(`${API_BASE}/v1/featured?kind=homepage`, { cache: "no-store" });
    if (!r.ok) return;
    const items = await r.json();
    if (!Array.isArray(items) || !items.length) return;
    grid.innerHTML = items.map(cardHtml).join("");
  } catch { /* garde le HTML statique */ }
}
