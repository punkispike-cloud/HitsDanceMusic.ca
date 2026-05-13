/* Drawer plein écran "Now Playing" (déclenché par click simple sur la pochette). */

import { $, escapeHtml } from "./util.js";
import { state } from "./state.js";
import { SLOT_TAGS } from "./schedule.js";
import { getAudio, togglePlayback } from "./player.js";
import { shareCurrent } from "./share.js";
import { toggleHistory } from "./history-drawer.js";

function ensureNowPlayingDrawer() {
  let d = document.getElementById("nowPlayingDrawer");
  if (d) return d;
  d = document.createElement("div");
  d.id = "nowPlayingDrawer";
  d.className = "np-drawer";
  d.hidden = true;
  d.setAttribute("role", "dialog");
  d.setAttribute("aria-modal", "true");
  d.setAttribute("aria-label", "Lecture en cours");
  d.innerHTML = `
    <div class="np-bg" aria-hidden="true"></div>
    <button type="button" class="np-close" id="npClose" aria-label="Fermer">×</button>
    <article class="np-card">
      <img id="npCover" class="np-cover" alt="" />
      <p class="np-tag" id="npTag"></p>
      <h2 class="np-title" id="npTitle"></h2>
      <p class="np-host" id="npHost"></p>
      <p class="np-track" id="npTrack" hidden></p>
      <div class="np-actions">
        <button type="button" class="np-play" id="npPlay">▶ Lecture</button>
        <button type="button" class="np-share" id="npShare" aria-label="Partager">🔗</button>
        <button type="button" class="np-hist" id="npHist" aria-label="Historique">🎵</button>
      </div>
    </article>`;
  document.body.appendChild(d);
  d.querySelector("#npClose").addEventListener("click", closeNowPlayingDrawer);
  d.querySelector(".np-bg").addEventListener("click", closeNowPlayingDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !d.hidden) closeNowPlayingDrawer();
  });
  d.querySelector("#npPlay").addEventListener("click", () => void togglePlayback());
  d.querySelector("#npShare").addEventListener("click", () => shareCurrent());
  d.querySelector("#npHist").addEventListener("click", () => { closeNowPlayingDrawer(); toggleHistory(true); });
  return d;
}

export function openNowPlayingDrawer() {
  const d = ensureNowPlayingDrawer();
  const cover = document.querySelector(".player-cover img, .player-cover");
  const coverSrc = (cover && cover.tagName === "IMG") ? cover.src : (state.currentCover || "");
  const npCover = d.querySelector("#npCover");
  const npBg = d.querySelector(".np-bg");
  if (coverSrc) {
    npCover.src = coverSrc;
    npBg.style.backgroundImage = `url("${coverSrc}")`;
  }
  d.querySelector("#npTitle").textContent = state.currentSlot?.title || "Hits Dance Music";
  d.querySelector("#npHost").textContent = state.currentSlot?.host || "";
  const tag = SLOT_TAGS?.[state.currentSlot?.tag] || null;
  const npTag = d.querySelector("#npTag");
  if (tag) {
    npTag.textContent = tag.label;
    npTag.style.setProperty("--tag-color", tag.color);
  }
  const trackEl = d.querySelector("#npTrack");
  if (state.currentTrack && state.currentTrack.title) {
    trackEl.hidden = false;
    trackEl.textContent = state.currentTrack.artist
      ? `♪ ${state.currentTrack.artist} — ${state.currentTrack.title}`
      : `♪ ${state.currentTrack.title}`;
  } else {
    trackEl.hidden = true;
  }
  const audio = getAudio();
  const npPlay = d.querySelector("#npPlay");
  npPlay.textContent = (audio && !audio.paused) ? "❚❚ Pause" : "▶ Lecture";
  d.hidden = false;
  // focus trap basique
  const focusables = d.querySelectorAll("button, a, [tabindex]");
  d.dataset.lastFocus = document.activeElement?.id || "";
  focusables[0]?.focus({ preventScroll: true });
  requestAnimationFrame(() => d.classList.add("is-open"));
}

export function closeNowPlayingDrawer() {
  const d = document.getElementById("nowPlayingDrawer");
  if (!d) return;
  d.classList.remove("is-open");
  document.body.style.overflow = "";
  const last = d.dataset.lastFocus ? document.getElementById(d.dataset.lastFocus) : null;
  setTimeout(() => {
    d.hidden = true;
    last?.focus?.();
  }, 280);
}
