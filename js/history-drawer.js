/* Drawer historique des morceaux + recherche + export JSON/CSV. */

import { $, $$, escapeHtml } from "./util.js";
import { getHistory } from "./now-playing.js";
import { store, STORAGE } from "./store.js";
import { toast } from "./toast.js";

function ensureHistoryDrawer() {
  let d = $("#historyDrawer");
  if (d) return d;
  d = document.createElement("aside");
  d.id = "historyDrawer";
  d.className = "history-drawer";
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
    <p class="history-empty" id="historyEmpty">Aucun morceau encore détecté pendant cette session.</p>`;
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
  d.hidden = !open;
  d.classList.toggle("is-open", open);
  if (open) renderHistory();
}

export function renderHistory() {
  const d = ensureHistoryDrawer();
  const list = $("#historyList", d);
  const empty = $("#historyEmpty", d);
  const items = getHistory();
  if (!items.length) {
    list.innerHTML = ""; empty.hidden = false; return;
  }
  empty.hidden = true;
  list.innerHTML = items.map((it) => {
    const time = new Date(it.at).toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });
    const cover = it.cover ? `<img src="${it.cover}" alt="" loading="lazy" decoding="async" width="44" height="44" />` : `<span class="history-cover-fallback" aria-hidden="true">♪</span>`;
    const label = it.artist ? `${escapeHtml(it.artist)} — ${escapeHtml(it.title)}` : escapeHtml(it.title);
    const search = encodeURIComponent(`${it.artist || ""} ${it.title}`.trim());
    return `<li>
      <div class="history-cover">${cover}</div>
      <div class="history-meta">
        <strong>${label}</strong>
        <span>${time}</span>
      </div>
      <a class="history-search" href="https://music.youtube.com/search?q=${search}" target="_blank" rel="noopener" aria-label="Chercher sur YouTube Music">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </a>
    </li>`;
  }).join("");
}

export function exportHistory(format = "json") {
  const items = store.getJSON(STORAGE.history, []);
  if (!items.length) { toast("Historique vide.", "info"); return; }
  let blob, name;
  if (format === "csv") {
    const header = "iso,artist,title\n";
    const rows = items.map((it) => `"${it.iso || ""}","${(it.artist || "").replace(/"/g,'""')}","${(it.title || "").replace(/"/g,'""')}"`).join("\n");
    blob = new Blob([header + rows], { type: "text/csv" });
    name = `hitradio-history-${Date.now()}.csv`;
  } else {
    blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    name = `hitradio-history-${Date.now()}.json`;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function injectHistorySearch() {
  const drawer = $("#historyDrawer");
  if (!drawer || drawer.querySelector(".history-search")) return;
  const head = drawer.querySelector(".history-head") || drawer.firstElementChild;
  const tools = document.createElement("div");
  tools.className = "history-search";
  tools.innerHTML = `
    <input type="search" id="historyFilter" placeholder="Filtrer (artiste, titre)…" />
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
