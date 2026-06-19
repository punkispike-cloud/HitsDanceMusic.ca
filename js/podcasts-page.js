/* Page Podcasts & Mixes (on-demand). Greffe additive : s'exécute UNIQUEMENT si
   la page contient .podcast-grid / .mix-grid (donc seulement podcasts.html).
   N'altère aucune autre page. Le lecteur à la demande est INDÉPENDANT du player
   live (qui garde son flux existant) ; démarrer un podcast met le live en pause. */

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

let odAudio = null;
/** Lecteur on-demand partagé (un seul à la fois). Met le live en pause. */
function getOnDemandAudio() {
  if (odAudio) return odAudio;
  odAudio = new Audio();
  odAudio.preload = "none";
  return odAudio;
}

function pauseLive() {
  // Met en pause tout autre <audio> (notamment le flux live) sans le détruire.
  document.querySelectorAll("audio").forEach((a) => {
    if (a !== odAudio && !a.paused) {
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
  return `<article class="od-card" id="od-${escapeHtml(item.slug)}">
    <div class="od-cover">${
      cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" />` : `<span class="od-cover-ph" aria-hidden="true">♪</span>`
    }</div>
    <div class="od-body">
      <span class="od-kind">${escapeHtml(sub)}</span>
      <h3>${escapeHtml(item.title)}</h3>
      ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
      <div class="od-actions">
        ${audio
          ? `<button type="button" class="od-play" data-audio="${escapeHtml(audio)}" data-title="${escapeHtml(item.title)}" aria-label="Lire ${escapeHtml(item.title)}">▶ Écouter${dur ? ` · ${dur}` : ""}</button>`
          : `<span class="od-soon">Bientôt disponible</span>`}
        <a class="od-share" href="${escapeHtml(shareUrl)}" target="_blank" rel="noopener">Partager</a>
      </div>
    </div>
  </article>`;
}

function wirePlayButtons(root) {
  const audio = getOnDemandAudio();
  root.querySelectorAll(".od-play").forEach((btn) => {
    btn.addEventListener("click", () => {
      const src = btn.getAttribute("data-audio");
      if (!src) return;
      const isSame = audio.src === src;
      if (isSame && !audio.paused) {
        audio.pause();
        btn.textContent = btn.textContent.replace("⏸", "▶");
        return;
      }
      pauseLive();
      // Réinitialise l'état visuel des autres boutons.
      root.querySelectorAll(".od-play").forEach((b) => {
        b.classList.remove("playing");
        b.textContent = b.textContent.replace("⏸", "▶");
      });
      if (!isSame) audio.src = src;
      audio.play().then(() => {
        btn.classList.add("playing");
        btn.textContent = btn.textContent.replace("▶", "⏸");
      }).catch(() => { /* lecture refusée — silencieux */ });
    });
  });
  audio.addEventListener("ended", () => {
    root.querySelectorAll(".od-play.playing").forEach((b) => {
      b.classList.remove("playing");
      b.textContent = b.textContent.replace("⏸", "▶");
    });
  });
}

function focusFromHash(root) {
  const slug = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  if (!slug) return;
  const el = root.querySelector(`#od-${CSS.escape(slug)}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("od-highlight");
  }
}

export async function initPodcastsPage() {
  const podGrid = document.querySelector(".podcast-grid");
  const mixGrid = document.querySelector(".mix-grid");
  if (!podGrid && !mixGrid) return; // pas la page podcasts → no-op

  const [episodes, mixes] = await Promise.all([
    podGrid ? fetchJson("/v1/episodes") : null,
    mixGrid ? fetchJson("/v1/mixes") : null,
  ]);

  if (podGrid) {
    if (Array.isArray(episodes) && episodes.length) {
      podGrid.innerHTML = episodes.map((e) => cardHtml(e, "episode")).join("");
      wirePlayButtons(podGrid);
    } else {
      podGrid.innerHTML = `<p class="od-empty">Les podcasts arrivent bientôt. Reste à l'écoute !</p>`;
    }
  }
  if (mixGrid) {
    if (Array.isArray(mixes) && mixes.length) {
      mixGrid.innerHTML = mixes.map((m) => cardHtml(m, "mix")).join("");
      wirePlayButtons(mixGrid);
    } else {
      mixGrid.innerHTML = `<p class="od-empty">Les mixes arrivent bientôt.</p>`;
    }
  }

  focusFromHash(podGrid || mixGrid);
}
