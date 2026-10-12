/* Page Podcasts & Mixes (on-demand). Filtres + modal détail épisode. */

import { escapeHtml } from "./util.js";
import { API_BASE } from "./api-config.js";
import { activateModalTrap } from "./a11y-modal.js";

let _allEpisodes = [];
let _allMixes = [];
let _odAudio = null;

async function fetchJson(path) {
  try {
    const r = await fetch(`${API_BASE}${path}`, { mode: "cors", cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

function fmtDur(sec) {
  if (!sec || sec < 1) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function getOnDemandAudio() {
  if (_odAudio) return _odAudio;
  _odAudio = new Audio();
  _odAudio.preload = "none";
  return _odAudio;
}

function pauseLive() {
  document.querySelectorAll("audio").forEach((a) => {
    if (a !== _odAudio && !a.paused) {
      try { a.pause(); } catch { /* noop */ }
    }
  });
}

function cardHtml(item, kind) {
  const cover = safeUrl(item.coverUrl) || (item.coverUrl && !/^https?:/i.test(item.coverUrl) ? item.coverUrl : null);
  const audio = safeUrl(item.audioUrl);
  const dur = fmtDur(item.durationSec);
  const sub = kind === "mix" ? (item.genre || "Mix") : "Podcast";
  const shareUrl = `${API_BASE}/v1/share/${kind === "mix" ? "mix" : "episode"}/${encodeURIComponent(item.slug)}`;
  return `<article class="od-card" id="od-${escapeHtml(item.slug)}" data-kind="${kind}" data-slug="${escapeHtml(item.slug)}" tabindex="0" role="button" aria-label="Voir ${escapeHtml(item.title)}">
    <div class="od-cover">${
      cover ? `<img src="${escapeHtml(cover)}" alt="Pochette : ${escapeHtml(item.title)}" loading="lazy" />` : `<span class="od-cover-ph" aria-hidden="true">♪</span>`
    }</div>
    <div class="od-body">
      <span class="od-kind">${escapeHtml(sub)}</span>
      <h3>${escapeHtml(item.title)}</h3>
      ${item.description ? `<p>${escapeHtml(item.description.slice(0, 120))}${item.description.length > 120 ? "…" : ""}</p>` : ""}
      <div class="od-actions">
        ${audio
          ? `<button type="button" class="od-play" data-audio="${escapeHtml(audio)}" data-title="${escapeHtml(item.title)}" aria-label="Lire ${escapeHtml(item.title)}">▶ Écouter${dur ? ` · ${dur}` : ""}</button>`
          : `<span class="od-soon">Bientôt disponible</span>`}
        <button type="button" class="od-detail-btn" data-slug="${escapeHtml(item.slug)}" data-kind="${kind}">Détails</button>
        <a class="od-share" href="${escapeHtml(shareUrl)}" target="_blank" rel="noopener">Partager</a>
      </div>
    </div>
  </article>`;
}

function odPosKey(src) {
  let h = 0;
  for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) >>> 0;
  return "hr.odPos." + h.toString(36);
}
function getOdPos(src) { try { const v = parseFloat(localStorage.getItem(odPosKey(src))); return Number.isFinite(v) && v > 5 ? v : 0; } catch { return 0; } }
function setOdPos(src, t) { try { localStorage.setItem(odPosKey(src), String(Math.floor(t))); } catch { /* noop */ } }

function wirePlayButtons(root) {
  const audio = getOnDemandAudio();
  // Reprise + vitesse + enchaîné : branchés une seule fois sur l'audio partagé.
  if (!audio.dataset.odWired) {
    audio.dataset.odWired = "1";
    audio.addEventListener("loadedmetadata", () => {
      const pos = getOdPos(audio.src);
      if (pos > 5 && audio.duration && pos < audio.duration - 10) {
        try { audio.currentTime = pos; } catch { /* noop */ }
      }
      const rate = parseFloat(localStorage.getItem("hr.odRate") || "1") || 1;
      try { audio.playbackRate = rate; } catch { /* noop */ }
    });
    audio.addEventListener("timeupdate", () => {
      if (!audio.src || audio.paused) return;
      if (Math.floor(audio.currentTime) % 5 === 0) setOdPos(audio.src, audio.currentTime);
    });
    audio.addEventListener("pause", () => { if (audio.src) setOdPos(audio.src, audio.currentTime); });
  }
  root.querySelectorAll(".od-play").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const src = btn.getAttribute("data-audio");
      if (!src) return;
      const card = btn.closest(".od-card");
      const slug = card?.dataset.slug || "";
      const pos = getOdPos(src);
      const isSame = audio.src === src;
      if (isSame && !audio.paused) {
        audio.pause();
        btn.textContent = btn.textContent.replace("⏸", "▶");
        return;
      }
      pauseLive();
      root.querySelectorAll(".od-play").forEach((b) => {
        b.classList.remove("playing");
        b.textContent = b.textContent.replace("⏸", "▶");
      });
      if (!isSame) audio.src = src;
      audio.play().then(() => {
        btn.classList.add("playing");
        const label = pos > 5 ? `⏸ Reprise ${fmtDur(pos)}` : btn.textContent.replace("▶", "⏸");
        btn.textContent = label;
        // Vitesse : cycle 1 → 1.25 → 1.5 → 2 → 1 sur double-clic droit ? Bouton dédié dans la modale.
      }).catch(() => {});
    });
  });
  audio.addEventListener("ended", () => {
    root.querySelectorAll(".od-play.playing").forEach((b) => {
      b.classList.remove("playing");
      b.textContent = b.textContent.replace("⏸", "▶");
    });
    // Enchaîné : joue le suivant de la liste filtrée.
    const plays = [...root.querySelectorAll(".od-play")];
    const idx = plays.findIndex((b) => b.getAttribute("data-audio") === audio.src);
    const next = plays[idx + 1];
    if (next) next.click();
  });
}

function openEpisodeModal(item, kind) {
  const existing = document.getElementById("episodeDetailModal");
  existing?.remove();
  const cover = item.coverUrl && safeUrl(item.coverUrl) ? item.coverUrl : (item.coverUrl || "");
  const audio = safeUrl(item.audioUrl);
  const overlay = document.createElement("div");
  overlay.id = "episodeDetailModal";
  overlay.className = "adetail-overlay is-open";
  overlay.innerHTML = `
    <div class="adetail episode-detail" role="dialog" aria-modal="true" aria-label="${escapeHtml(item.title)}">
      <button class="adetail-close" aria-label="Fermer">×</button>
      ${cover ? `<div class="od-detail-cover"><img src="${escapeHtml(cover)}" alt="Pochette : ${escapeHtml(item.title)}" /></div>` : ""}
      <span class="od-kind">${kind === "mix" ? escapeHtml(item.genre || "Mix") : "Podcast"}</span>
      <h2>${escapeHtml(item.title)}</h2>
      ${item.description ? `<p class="adetail-bio">${escapeHtml(item.description)}</p>` : ""}
      ${item.durationSec ? `<p class="muted">Durée : ${fmtDur(item.durationSec)}</p>` : ""}
      ${audio ? `<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center"><button type="button" class="button primary od-modal-play" data-audio="${escapeHtml(audio)}">▶ Écouter</button><button type="button" class="button ghost-light btn-xs od-rate" aria-label="Vitesse de lecture">Vitesse : 1x</button></div>` : ""}
      <a class="text-link" href="podcasts.html#${encodeURIComponent(item.slug)}">Lien direct</a>
    </div>`;
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector(".adetail-close")?.addEventListener("click", () => overlay.remove());
  const rateBtn = overlay.querySelector(".od-rate");
  if (rateBtn) {
    const rates = [1, 1.25, 1.5, 2];
    let ri = rates.indexOf(parseFloat(localStorage.getItem("hr.odRate") || "1"));
    if (ri < 0) ri = 0;
    rateBtn.textContent = `Vitesse : ${rates[ri]}x`;
    rateBtn.addEventListener("click", () => {
      ri = (ri + 1) % rates.length;
      try { localStorage.setItem("hr.odRate", String(rates[ri])); getOnDemandAudio().playbackRate = rates[ri]; } catch { /* noop */ }
      rateBtn.textContent = `Vitesse : ${rates[ri]}x`;
    });
  }
  overlay.querySelector(".od-modal-play")?.addEventListener("click", () => {
    const src = overlay.querySelector(".od-modal-play")?.getAttribute("data-audio");
    if (!src) return;
    pauseLive();
    const a = getOnDemandAudio();
    a.src = src;
    void a.play();
  });
  document.body.appendChild(overlay);
  activateModalTrap(overlay, { closeBtn: overlay.querySelector(".adetail-close") });
}

function wireDetailButtons(root) {
  root.querySelectorAll(".od-detail-btn, .od-card[data-slug]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".od-play") || e.target.closest(".od-share")) return;
      const card = e.target.closest(".od-card");
      if (!card) return;
      const slug = card.dataset.slug;
      const kind = card.dataset.kind;
      const pool = kind === "mix" ? _allMixes : _allEpisodes;
      const item = pool.find((x) => x.slug === slug);
      if (item) openEpisodeModal(item, kind);
    });
  });
}

function applyFilters() {
  const kind = document.getElementById("podFilterKind")?.value || "all";
  const q = (document.getElementById("podFilterSearch")?.value || "").trim().toLowerCase();
  const podGrid = document.querySelector(".podcast-grid");
  const mixGrid = document.querySelector(".mix-grid");
  const match = (item) => {
    if (q && !`${item.title} ${item.description || ""} ${item.genre || ""}`.toLowerCase().includes(q)) return false;
    return true;
  };
  if (podGrid && (kind === "all" || kind === "episode")) {
    const list = _allEpisodes.filter(match);
    podGrid.innerHTML = list.length
      ? list.map((e) => cardHtml(e, "episode")).join("")
      : `<p class="od-empty">Aucun podcast ne correspond.</p>`;
    wirePlayButtons(podGrid);
    wireDetailButtons(podGrid);
  } else if (podGrid) {
    podGrid.innerHTML = `<p class="od-empty muted">Filtre actif — voir les mixes.</p>`;
  }
  if (mixGrid && (kind === "all" || kind === "mix")) {
    const list = _allMixes.filter(match);
    mixGrid.innerHTML = list.length
      ? list.map((m) => cardHtml(m, "mix")).join("")
      : `<p class="od-empty">Aucun mix ne correspond.</p>`;
    wirePlayButtons(mixGrid);
    wireDetailButtons(mixGrid);
  } else if (mixGrid) {
    mixGrid.innerHTML = `<p class="od-empty muted">Filtre actif — voir les podcasts.</p>`;
  }
}

function focusFromHash(root) {
  const slug = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  if (!slug) return;
  const el = root.querySelector(`#od-${CSS.escape(slug)}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("od-highlight");
    const kind = el.dataset.kind;
    const pool = kind === "mix" ? _allMixes : _allEpisodes;
    const item = pool.find((x) => x.slug === slug);
    if (item) openEpisodeModal(item, kind);
  }
}

export async function initPodcastsPage() {
  const podGrid = document.querySelector(".podcast-grid");
  const mixGrid = document.querySelector(".mix-grid");
  if (!podGrid && !mixGrid) return;

  const [episodes, mixes] = await Promise.all([
    podGrid ? fetchJson("/v1/episodes") : null,
    mixGrid ? fetchJson("/v1/mixes") : null,
  ]);
  _allEpisodes = Array.isArray(episodes) ? episodes : [];
  _allMixes = Array.isArray(mixes) ? mixes : [];

  const filters = document.getElementById("podFilters");
  if (filters) {
    filters.querySelector("#podFilterKind")?.addEventListener("change", applyFilters);
    filters.querySelector("#podFilterSearch")?.addEventListener("input", applyFilters);
  }

  if (podGrid && !_allEpisodes.length) {
    podGrid.innerHTML = `<p class="od-empty">Les podcasts arrivent bientôt. Reste à l'écoute !</p>`;
  }
  if (mixGrid && !_allMixes.length) {
    mixGrid.innerHTML = `<p class="od-empty">Les mixes arrivent bientôt.</p>`;
  }
  if (_allEpisodes.length || _allMixes.length) applyFilters();
  focusFromHash(podGrid || mixGrid);
}
