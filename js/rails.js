/* Wave 4 — bandes scrollables : prochaines émissions, replays, à la une. */

import { $, $$, escapeHtml } from "./util.js";
import { API_BASE } from "./api-config.js";
import { SCHEDULE, SLOT_TAGS } from "./schedule.js";
import { DAY_NAMES, getMontrealParts, toMinutes } from "./time.js";

const NEWS_FALLBACK = [
  { tag: "DJ Set", title: "DJ JÜMPOFF — JÜMPOFFproject", text: "Mix club et soirées énergie dance, plusieurs créneaux du mercredi au dimanche.", emoji: "🎚️" },
  { tag: "Antenne", title: "Hommage Limelight Montréal", text: "DJ Pierre Jutras revient cette semaine avec quatre créneaux signatures.", emoji: "🎙" },
  { tag: "Émission", title: "Nouvelle saison de Hit Drive", text: "Du lundi au vendredi 16h–18h, l'antenne accélère pour la sortie des bureaux.", emoji: "🚗" },
];

function rail(title, emoji, items, renderItem, opts = {}) {
  return `
    <div class="rail">
      <div class="rail-head">
        <h2><span aria-hidden="true">${emoji}</span> ${escapeHtml(title)}</h2>
        ${opts.cta ? `<a class="rail-cta" href="${opts.cta.href}">${escapeHtml(opts.cta.label)} →</a>` : ""}
        <div class="rail-arrows" role="group" aria-label="Faire défiler">
          <button type="button" class="rail-arrow" data-dir="-1" aria-label="Précédent">‹</button>
          <button type="button" class="rail-arrow" data-dir="1" aria-label="Suivant">›</button>
        </div>
      </div>
      <div class="rail-track" tabindex="0">
        ${items.map(renderItem).join("")}
      </div>
    </div>`;
}

function bindRailArrows() {
  $$(".rail").forEach((r) => {
    const track = $(".rail-track", r);
    if (!track) return;
    $$(".rail-arrow", r).forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = Number(btn.dataset.dir) || 1;
        track.scrollBy({ left: dir * Math.min(track.clientWidth * 0.85, 600), behavior: "smooth" });
      });
    });
  });
}

async function fetchJson(path) {
  try {
    const r = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

export function renderRailUpcoming() {
  const root = $("#rail-upcoming");
  if (!root) return;
  const items = [];
  const { day, hour, minute } = getMontrealParts();
  const nowMin = hour * 60 + minute;
  for (let off = 0; off < 7 && items.length < 8; off++) {
    const d = (day + off) % 7;
    const slots = SCHEDULE[d] || [];
    for (const [from, to, title, host, tag] of slots) {
      const fromMin = toMinutes(from);
      if (off === 0 && fromMin <= nowMin) continue;
      const realDelta = off === 0 ? (fromMin - nowMin) : ((24 * 60 - nowMin) + (off - 1) * 24 * 60 + fromMin);
      items.push({ from, to, title, host, tag, day: d, when: realDelta });
      if (items.length >= 8) break;
    }
  }
  if (!items.length) return;
  root.hidden = false;
  root.innerHTML = rail("Prochaines émissions", "🕓", items, (it) => {
    const tag = SLOT_TAGS[it.tag] || SLOT_TAGS.hitlist;
    const h = Math.floor(it.when / 60);
    const m = it.when % 60;
    const when = h > 0 ? `dans ${h} h ${String(m).padStart(2, "0")}` : `dans ${m} min`;
    return `<article class="rail-card upcoming-card" style="--card-accent:${tag.color}">
      <span class="rail-tag">${escapeHtml(tag.label)}</span>
      <h3>${escapeHtml(it.title)}</h3>
      <p class="rail-meta">${DAY_NAMES[it.day]} · ${it.from}–${it.to}</p>
      <p class="rail-host">${escapeHtml(it.host || "Programmation")}</p>
      <p class="rail-when">${when}</p>
    </article>`;
  }, { cta: { href: "horaire.html", label: "Voir la grille" } });
}

function scheduleFallbackItems() {
  const seen = new Set();
  const items = [];
  for (const day of Object.values(SCHEDULE)) {
    for (const [from, to, title, host, tag] of day) {
      if (seen.has(title)) continue;
      seen.add(title);
      items.push({ title, host, tag, sample: `${from}–${to}`, href: `emissions.html?show=${title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")}` });
      if (items.length >= 10) break;
    }
    if (items.length >= 10) break;
  }
  return items;
}

export async function renderRailReplays() {
  const root = $("#rail-replays");
  if (!root) return;
  const [episodes, mixes] = await Promise.all([
    fetchJson("/v1/episodes"),
    fetchJson("/v1/mixes"),
  ]);
  let items = [];
  if (Array.isArray(episodes)) {
    for (const e of episodes.slice(0, 8)) {
      items.push({
        title: e.title,
        host: "Podcast",
        tag: "special",
        sample: e.durationSec ? `${Math.floor(e.durationSec / 60)} min` : "À réécouter",
        href: `podcasts.html#${encodeURIComponent(e.slug)}`,
        kind: "episode",
      });
    }
  }
  if (Array.isArray(mixes)) {
    for (const m of mixes.slice(0, 6)) {
      items.push({
        title: m.title,
        host: m.genre || "Mix",
        tag: "night",
        sample: m.durationSec ? `${Math.floor(m.durationSec / 60)} min` : "DJ set",
        href: `podcasts.html#${encodeURIComponent(m.slug)}`,
        kind: "mix",
      });
    }
  }
  if (!items.length) items = scheduleFallbackItems();
  root.hidden = false;
  root.innerHTML = rail("Replays & podcasts", "🎙", items, (it) => {
    const tag = SLOT_TAGS[it.tag] || SLOT_TAGS.hitlist;
    return `<a class="rail-card replay-card" href="${escapeHtml(it.href)}" style="--card-accent:${tag.color}">
      <span class="rail-tag">${escapeHtml(it.kind === "mix" ? "Mix" : "Replay")}</span>
      <h3>${escapeHtml(it.title)}</h3>
      <p class="rail-meta">${escapeHtml(it.host || "Programmation")}</p>
      <p class="rail-when">${escapeHtml(it.sample)}</p>
    </a>`;
  }, { cta: { href: "podcasts.html", label: "Tous les replays" } });
}

export async function renderRailNews() {
  const root = $("#rail-news");
  if (!root) return;
  let newsItems = NEWS_FALLBACK;
  try {
    const r = await fetch(`${API_BASE}/v1/featured?kind=rail`, { cache: "no-store" });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) {
        newsItems = rows.map((it) => ({
          tag: it.tag || "Info",
          title: it.title,
          text: it.body || it.meta || "",
          emoji: it.emoji || "✨",
        }));
      }
    }
  } catch { /* fallback */ }
  root.hidden = false;
  root.innerHTML = rail("À la une", "✨", newsItems, (it) => {
    return `<article class="rail-card news-card">
      <span class="rail-emoji" aria-hidden="true">${it.emoji}</span>
      <span class="rail-tag">${escapeHtml(it.tag)}</span>
      <h3>${escapeHtml(it.title)}</h3>
      <p class="rail-meta">${escapeHtml(it.text)}</p>
    </article>`;
  });
}

export function renderAllRails() {
  renderRailUpcoming();
  void renderRailReplays();
  void renderRailNews();
  bindRailArrows();
}
