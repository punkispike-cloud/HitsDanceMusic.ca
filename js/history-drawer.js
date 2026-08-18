/* Drawer historique des morceaux + 🤘 j'aime — alimenté par l'API
   (GET /v1/tracks/recent) avec repli sur l'historique de session. */

import { $, $$, escapeHtml, safeAnimate, EASE_OUT } from "./util.js";
import { getHistory } from "./now-playing.js";
import { store, STORAGE } from "./store.js";
import { toast } from "./toast.js";
import { fetchRecentTracks, toggleTrackLike, getLikedSet, saveLikedSet, fmtTrackTime } from "./track-likes.js";
import { activateModalTrap } from "./a11y-modal.js";

let _apiTracks = [];
let _releaseTrap = null;
let _previousFocus = null;

function ensureHistoryDrawer() {
  let d = $("#historyDrawer");
  if (d) return d;
  d = document.createElement("aside");
  d.id = "historyDrawer";
  d.className = "history-drawer";
  d.setAttribute("role", "dialog");
  d.setAttribute("aria-modal", "true");
  d.setAttribute("aria-label", "Historique des morceaux diffusés");
  d.hidden = true;
  d.innerHTML = `
    <header class="history-head">
      <strong>Derniers morceaux</strong>
      <button type="button" class="icon-btn" id="historyClose" aria-label="Fermer l'historique">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
      </button>
    </header>
    <ol class="history-list" id="historyList"></ol>
    <p class="history-empty" id="historyEmpty">Aucun morceau encore détecté.</p>`;
  document.body.appendChild(d);
  $("#historyClose", d).addEventListener("click", () => toggleHistory(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !d.hidden) toggleHistory(false);
  });
  return d;
}

export function toggleHistory(force) {
  const d = ensureHistoryDrawer();
  const open = typeof force === "boolean" ? force : d.hidden;
  if (open) {
    _previousFocus = document.activeElement;
    d.hidden = false;
    d.classList.add("is-open");
    _releaseTrap?.();
    _releaseTrap = activateModalTrap(d, {
      closeBtn: $("#historyClose", d),
      previousFocus: _previousFocus,
    });
    void renderHistory();
  } else {
    d.classList.remove("is-open");
    if (_releaseTrap) {
      _releaseTrap();
      _releaseTrap = null;
      _previousFocus = null;
    }
    d.hidden = true;
  }
}

function sessionFallbackItems() {
  return getHistory().map((it) => ({
    id: null,
    artist: it.artist || "",
    title: it.title || "",
    playedAt: it.iso || new Date(it.at).toISOString(),
    likes: 0,
    cover: it.cover,
    at: it.at,
  }));
}

function renderLikeBtn(track) {
  if (!track.id) return "";
  const liked = getLikedSet().has(track.id);
  return `<button type="button" class="history-like trk-like" data-track-id="${escapeHtml(track.id)}" aria-pressed="${liked}" aria-label="J'aime ce titre">🤘 <span>${track.likes ?? 0}</span></button>`;
}

function trackAlt(it) {
  const label = it.artist ? `${it.artist} — ${it.title}` : it.title;
  return escapeHtml(label || "Pochette du morceau");
}

function wireLikeButtons(listEl) {
  listEl.querySelectorAll(".history-like[data-track-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const trackId = btn.dataset.trackId;
      if (!trackId) return;
      const currentlyLiked = btn.getAttribute("aria-pressed") === "true";
      btn.disabled = true;
      try {
        const res = await toggleTrackLike(trackId, currentlyLiked);
        const set = getLikedSet();
        if (res.liked) set.add(trackId);
        else set.delete(trackId);
        saveLikedSet(set);
        btn.setAttribute("aria-pressed", String(res.liked));
        btn.querySelector("span").textContent = String(res.likes ?? 0);
      } catch { /* réseau */ } finally {
        btn.disabled = false;
      }
    });
  });
}

export async function renderHistory() {
  const d = ensureHistoryDrawer();
  const list = $("#historyList", d);
  const empty = $("#historyEmpty", d);
  try {
    _apiTracks = await fetchRecentTracks(30);
  } catch {
    _apiTracks = [];
  }
  const items = _apiTracks.length ? _apiTracks : sessionFallbackItems();
  if (!items.length) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = items.map((it) => {
    const time = it.at
      ? new Date(it.at).toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" })
      : fmtTrackTime(it.playedAt);
    const coverUrl = typeof it.cover === "string" && /^https:\/\//i.test(it.cover) ? escapeHtml(it.cover) : "";
    const cover = coverUrl
      ? `<img src="${coverUrl}" alt="${trackAlt(it)}" loading="lazy" decoding="async" width="44" height="44" />`
      : `<span class="history-cover-fallback" aria-hidden="true">♪</span>`;
    const label = it.artist ? `${escapeHtml(it.artist)} — ${escapeHtml(it.title)}` : escapeHtml(it.title);
    const search = encodeURIComponent(`${it.artist || ""} ${it.title}`.trim());
    return `<li>
      <div class="history-cover">${cover}</div>
      <div class="history-meta">
        <strong>${label}</strong>
        <span>${time}</span>
      </div>
      <div class="history-actions">
        ${renderLikeBtn(it)}
        <a class="history-search" href="https://music.youtube.com/search?q=${search}" target="_blank" rel="noopener" aria-label="Chercher sur YouTube Music">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </a>
      </div>
    </li>`;
  }).join("");
  wireLikeButtons(list);
  list.querySelectorAll("li").forEach((li, i) => safeAnimate(li, [
    { opacity: 0, transform: "translateX(-12px)" },
    { opacity: 1, transform: "translateX(0)" },
  ], { duration: 380, delay: i * 40, easing: EASE_OUT, fill: "both" }));
}

export function exportHistory(format = "json") {
  const items = _apiTracks.length
    ? _apiTracks.map((t) => ({ iso: t.playedAt, artist: t.artist, title: t.title }))
    : store.getJSON(STORAGE.history, []);
  if (!items.length) { toast("Historique vide.", "info"); return; }
  let blob, name;
  if (format === "csv") {
    const header = "iso,artist,title\n";
    const rows = items.map((it) => `"${it.iso || ""}","${(it.artist || "").replace(/"/g, '""')}","${(it.title || "").replace(/"/g, '""')}"`).join("\n");
    blob = new Blob([header + rows], { type: "text/csv" });
    name = `hitradio-history-${Date.now()}.csv`;
  } else {
    blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    name = `hitradio-history-${Date.now()}.json`;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function injectHistorySearch() {
  const drawer = $("#historyDrawer");
  if (!drawer || drawer.querySelector("#historyFilter")) return;
  const head = drawer.querySelector(".history-head") || drawer.firstElementChild;
  const tools = document.createElement("div");
  tools.className = "history-search";
  tools.innerHTML = `
    <label for="historyFilter" class="sr-only">Filtrer l'historique par artiste ou titre</label>
    <input type="search" id="historyFilter" placeholder="Filtrer (artiste, titre)…" aria-label="Filtrer l'historique par artiste ou titre" />
    <button type="button" class="btn btn-ghost btn-xs" id="exportHistJson">JSON</button>
    <button type="button" class="btn btn-ghost btn-xs" id="exportHistCsv">CSV</button>`;
  head.insertAdjacentElement("afterend", tools);
  $("#historyFilter").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    $$("#historyDrawer li").forEach((li) => {
      li.style.display = !q || li.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  });
  $("#exportHistJson").addEventListener("click", () => exportHistory("json"));
  $("#exportHistCsv").addEventListener("click", () => exportHistory("csv"));
}
