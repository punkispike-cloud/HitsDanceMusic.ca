/* Drawer plein écran "Now Playing" (déclenché par click simple sur la pochette). */

import { $, escapeHtml, safeAnimate, EASE_OUT } from "./util.js";
import { state } from "./state.js";
import { SLOT_TAGS } from "./schedule.js";
import { getAudio, togglePlayback } from "./player.js";
import { shareCurrent } from "./share.js";
import { toggleHistory } from "./history-drawer.js";
import { BRAND } from "./brand.generated.js";
import { activateModalTrap } from "./a11y-modal.js";

let _releaseTrap = null;
let _previousFocus = null;

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
  const slotTitle = state.currentSlot?.title || BRAND.name;
  d.querySelector("#npTitle").textContent = slotTitle;
  d.querySelector("#npHost").textContent = state.currentSlot?.host || "";
  if (state.currentTrack?.title) {
    npCover.alt = state.currentTrack.artist
      ? `${state.currentTrack.artist} — ${state.currentTrack.title}`
      : state.currentTrack.title;
  } else {
    npCover.alt = slotTitle;
  }
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
  _previousFocus = document.activeElement;
  d.hidden = false;
  _releaseTrap?.();
  _releaseTrap = activateModalTrap(d, {
    closeBtn: d.querySelector("#npClose"),
    previousFocus: _previousFocus,
  });
  requestAnimationFrame(() => d.classList.add("is-open"));

  const npTrackEl = d.querySelector("#npTrack");
  const steps = [
    [d.querySelector("#npCover"), 0],
    [d.querySelector("#npTag"), 100],
    [d.querySelector("#npTitle"), 200],
    [(npTrackEl && !npTrackEl.hidden) ? npTrackEl : null, 280],
    [d.querySelector(".np-actions"), 400],
  ];
  for (const [el, delay] of steps) {
    if (!el) continue;
    el.getAnimations?.().forEach((a) => a.cancel());
    safeAnimate(el, [
      { opacity: 0, transform: "translateY(10px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: 360, delay, easing: EASE_OUT, fill: "both" });
  }
}

export function closeNowPlayingDrawer() {
  const d = document.getElementById("nowPlayingDrawer");
  if (!d) return;
  d.classList.remove("is-open");
  document.body.style.overflow = "";
  if (_releaseTrap) {
    _releaseTrap();
    _releaseTrap = null;
    _previousFocus = null;
  }
  setTimeout(() => { d.hidden = true; }, 280);
}
