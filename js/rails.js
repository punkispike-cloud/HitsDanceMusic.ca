/* Wave 4 — bandes scrollables : prochaines émissions, replays, à la une.
   (Rail "webradios" supprimé Sprint 1 : c'était un faux choix.) */

import { $, $$, escapeHtml } from "./util.js";
import { SCHEDULE, SLOT_TAGS } from "./schedule.js";
import { DAY_NAMES, getMontrealParts, toMinutes } from "./time.js";

const NEWS_ITEMS = [
  { tag: "DJ Set",  title: "DJ JÜMPOFF — JÜMPOFFproject", text: "Mix club et soirées énergie dance, plusieurs créneaux du mercredi au dimanche.", emoji: "🎚️" },
  { tag: "Antenne", title: "Hommage Limelight Montréal", text: "DJ Pierre Jutras revient cette semaine avec quatre créneaux signatures.", emoji: "🎙" },
  { tag: "Émission", title: "Nouvelle saison de Hit Drive", text: "Du lundi au vendredi 16h–18h, l'antenne accélère pour la sortie des bureaux.", emoji: "🚗" },
  { tag: "Nuit",    title: "BeatRadioWorld : Best DJ's internationaux", text: "Tous les soirs 22h–07h, mixes live d'Europe, Amérique, Asie.", emoji: "🌙" },
  { tag: "Studio",  title: "Alain Perron en matinale", text: "Café-actu-musique chaque matin 7h–9h. Appelle au 418-261-2886.", emoji: "☕" },
  { tag: "Mix",     title: "DJ OSKANA — Show européen", text: "Jeudi 21h et samedi 21h pour la house continentale.", emoji: "🎧" },
  { tag: "Latino",  title: "Latino Show samedi", text: "Reggaeton, urbano et latin house par les meilleurs DJs de Montréal.", emoji: "🌶️" },
  { tag: "Live",    title: "Ibiza — Le Chiwawa beach club", text: "Captations live des soirées Chiwawa : vibes balearic, house solaire et coucher de soleil.", emoji: "🌅" },
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
    const when = h > 0 ? `dans ${h} h ${String(m).padStart(2,"0")}` : `dans ${m} min`;
    return `<article class="rail-card upcoming-card" style="--card-accent:${tag.color}">
      <span class="rail-tag">${escapeHtml(tag.label)}</span>
      <h3>${escapeHtml(it.title)}</h3>
      <p class="rail-meta">${DAY_NAMES[it.day]} · ${it.from}–${it.to}</p>
      <p class="rail-host">${escapeHtml(it.host || "Programmation")}</p>
      <p class="rail-when">${when}</p>
    </article>`;
  }, { cta: { href: "horaire.html", label: "Voir la grille" } });
}

export function renderRailReplays() {
  const root = $("#rail-replays");
  if (!root) return;
  const seen = new Set();
  const items = [];
  for (const day of Object.values(SCHEDULE)) {
    for (const [from, to, title, host, tag] of day) {
      if (seen.has(title)) continue;
      seen.add(title);
      items.push({ title, host, tag, sample: `${from}–${to}` });
      if (items.length >= 10) break;
    }
    if (items.length >= 10) break;
  }
  root.hidden = false;
  root.innerHTML = rail("Toutes les émissions", "🎙", items, (it) => {
    const tag = SLOT_TAGS[it.tag] || SLOT_TAGS.hitlist;
    const slug = it.title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-");
    return `<a class="rail-card replay-card" href="emissions.html?show=${slug}" style="--card-accent:${tag.color}">
      <span class="rail-tag">${escapeHtml(tag.label)}</span>
      <h3>${escapeHtml(it.title)}</h3>
      <p class="rail-meta">${escapeHtml(it.host || "Programmation")}</p>
      <p class="rail-when">Créneau type · ${it.sample}</p>
    </a>`;
  }, { cta: { href: "emissions.html", label: "Toutes les émissions" } });
}

export function renderRailNews() {
  const root = $("#rail-news");
  if (!root) return;
  root.hidden = false;
  root.innerHTML = rail("À la une", "✨", NEWS_ITEMS, (it) => {
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
  renderRailReplays();
  renderRailNews();
  bindRailArrows();
}
