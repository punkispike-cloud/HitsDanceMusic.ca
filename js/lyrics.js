/* Paroles synchronisées via LRCLib (sans clé, CORS OK). */

import { $, $$, escapeHtml, fetchWithTimeout, clampLyrics, NET_TIMEOUTS } from "./util.js";
import { state } from "./state.js";

const _lyricsCache = new Map();
let _lyricsLines = [];
let _lyricsStartTs = 0;

async function fetchLyrics(artist, title) {
  if (!artist || !title) return null;
  const key = `${artist}::${title}`.toLowerCase();
  if (_lyricsCache.has(key)) return _lyricsCache.get(key);
  try {
    const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
    const r = await fetchWithTimeout(url, { cache: "no-store" }, NET_TIMEOUTS.lyrics);
    if (!r.ok) { _lyricsCache.set(key, null); return null; }
    const data = await r.json();
    const result = {
      synced: clampLyrics(data?.syncedLyrics) || null,
      plain:  clampLyrics(data?.plainLyrics)  || null,
    };
    _lyricsCache.set(key, result);
    return result;
  } catch { return null; }
}

function parseSyncedLyrics(synced) {
  if (!synced) return [];
  const lines = [];
  for (const raw of synced.split("\n")) {
    const m = raw.match(/^\[(\d+):(\d+)(?:\.(\d+))?\](.*)$/);
    if (!m) continue;
    const t = +m[1] * 60 + +m[2] + (m[3] ? +`0.${m[3]}` : 0);
    lines.push({ t, text: m[4].trim() });
  }
  return lines;
}

function ensureLyricsPanel() {
  if ($("#lyricsPanel")) return;
  const p = document.createElement("aside");
  p.id = "lyricsPanel";
  p.className = "lyrics-panel";
  p.hidden = true;
  p.innerHTML = `
    <header class="lyrics-head" id="lyricsHead">
      <strong>🎤 Paroles</strong>
      <span class="lyrics-status" id="lyricsStatus">—</span>
      <button type="button" class="lyrics-min" aria-label="Réduire" title="Réduire">–</button>
      <button type="button" class="lyrics-close" aria-label="Fermer les paroles" title="Fermer">×</button>
    </header>
    <div class="lyrics-body" id="lyricsBody"><p class="lyrics-empty">En attente du prochain titre…</p></div>`;
  document.body.appendChild(p);
  p.querySelector(".lyrics-close").addEventListener("click", toggleLyrics);
  p.querySelector(".lyrics-min").addEventListener("click", () => {
    p.classList.toggle("is-min");
    p.querySelector(".lyrics-min").textContent = p.classList.contains("is-min") ? "□" : "–";
  });
  const head = p.querySelector(".lyrics-head");
  let drag = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const r = p.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
    p.classList.add("is-drag");
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const x = Math.max(8, Math.min(window.innerWidth - p.offsetWidth - 8, e.clientX - drag.dx));
    const y = Math.max(8, Math.min(window.innerHeight - 60, e.clientY - drag.dy));
    p.style.left = x + "px"; p.style.top = y + "px"; p.style.right = "auto";
  });
  head.addEventListener("pointerup", () => { drag = null; p.classList.remove("is-drag"); });
}

export function toggleLyrics() {
  ensureLyricsPanel();
  const p = $("#lyricsPanel");
  p.hidden = !p.hidden;
  if (!p.hidden) refreshLyrics();
}

export async function refreshLyrics() {
  const status = $("#lyricsStatus");
  const body = $("#lyricsBody");
  if (!body) return;
  if (!state.currentTrack || !state.currentTrack.artist || !state.currentTrack.title) {
    body.innerHTML = `<p class="lyrics-empty">Aucun titre détecté (CORS bloque le flux Centova depuis le navigateur).</p>`;
    if (status) status.textContent = "—";
    _lyricsLines = [];
    return;
  }
  if (status) status.textContent = "Recherche…";
  const lyrics = await fetchLyrics(state.currentTrack.artist, state.currentTrack.title);
  if (!lyrics || (!lyrics.synced && !lyrics.plain)) {
    body.innerHTML = `<p class="lyrics-empty">Pas de paroles trouvées pour <em>${escapeHtml(state.currentTrack.title)}</em>.</p>`;
    if (status) status.textContent = "Aucun résultat";
    _lyricsLines = [];
    return;
  }
  if (lyrics.synced) {
    _lyricsLines = parseSyncedLyrics(lyrics.synced);
    _lyricsStartTs = Date.now();
    body.innerHTML = _lyricsLines.map((l, i) => `<p class="lyrics-line" data-i="${i}">${escapeHtml(l.text || "♪")}</p>`).join("");
    if (status) status.textContent = "Synchronisé";
  } else {
    _lyricsLines = [];
    body.innerHTML = `<pre class="lyrics-plain">${escapeHtml(lyrics.plain)}</pre>`;
    if (status) status.textContent = "Texte simple";
  }
}

export function tickLyrics() {
  if (!_lyricsLines.length) return;
  const panel = $("#lyricsPanel");
  if (!panel || panel.hidden) return;
  const elapsed = (Date.now() - _lyricsStartTs) / 1000;
  let active = 0;
  for (let i = 0; i < _lyricsLines.length; i++) {
    if (_lyricsLines[i].t <= elapsed) active = i;
    else break;
  }
  $$(".lyrics-line", panel).forEach((el, i) => {
    el.classList.toggle("is-active", i === active);
    el.classList.toggle("is-past", i < active);
  });
  const activeEl = panel.querySelector(`.lyrics-line[data-i="${active}"]`);
  if (activeEl) activeEl.scrollIntoView({ block: "center", behavior: "smooth" });
}
