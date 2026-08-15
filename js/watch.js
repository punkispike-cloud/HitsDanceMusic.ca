/* Mode plein écran "Watch" : lecteur immersif accessible via bouton player ou raccourci W. */

import { $ } from "./util.js";
import { state } from "./state.js";
import { SLOT_TAGS, getNextSlot, getCurrentSlot } from "./schedule.js";
import { store, STORAGE } from "./store.js";
import { getAudio, startPlayback, pausePlayback, toggleMute, setWatchSyncHook } from "./player.js";
import { shareCurrent } from "./share.js";
import { toggleLyrics } from "./lyrics.js";
import { togglePip } from "./pip.js";
import { floatEmoji } from "./emoji-float.js";
import { BRAND } from "./brand.generated.js";

let _watchClockTimer = 0;

function ensureWatchMode() {
  if ($("#watchMode")) return;
  const wm = document.createElement("div");
  wm.id = "watchMode";
  wm.className = "watch-mode";
  wm.hidden = true;
  wm.setAttribute("role", "dialog");
  wm.setAttribute("aria-label", "Lecteur plein écran");
  wm.innerHTML = `
    <div class="watch-backdrop" id="watchBackdrop" aria-hidden="true"></div>
    <div class="watch-blobs" aria-hidden="true">
      <span class="wb wb-1"></span><span class="wb wb-2"></span><span class="wb wb-3"></span>
    </div>
    <div class="watch-grain" aria-hidden="true"></div>
    <header class="watch-top">
      <div class="watch-brand">
        <span class="watch-live-dot"></span>
        <span class="watch-live-label">EN DIRECT</span>
        <span class="watch-clock" id="watchClock">--:--</span>
      </div>
      <div class="watch-top-actions">
        <button type="button" class="watch-icon" id="watchLyricsBtn" title="Paroles" aria-label="Paroles">🎤</button>
        <button type="button" class="watch-icon" id="watchPipBtn" title="Picture-in-Picture" aria-label="Picture-in-Picture">🗔</button>
        <button type="button" class="watch-icon watch-close" title="Fermer (Esc)" aria-label="Fermer">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
        </button>
      </div>
    </header>

    <div class="watch-stage">
      <div class="watch-vinyl" id="watchVinyl" aria-hidden="true">
        <div class="watch-cover" id="watchCover">
          <span class="watch-cover-mark">HR</span>
        </div>
        <div class="watch-vinyl-ring"></div>
      </div>
      <div class="watch-bars" id="watchBars" aria-hidden="true">
        ${Array.from({length: 24}, (_, i) => `<span style="--i:${i}"></span>`).join("")}
      </div>
      <div class="watch-info">
        <p class="watch-tag" id="watchTag">LIVE · ${BRAND.name}</p>
        <h2 class="watch-title" id="watchTitle">En direct</h2>
        <p class="watch-host" id="watchHost">Programmation</p>
        <p class="watch-track" id="watchTrack" hidden></p>
      </div>
    </div>

    <div class="watch-controls">
      <button type="button" class="watch-btn watch-btn--small" id="watchMute" aria-label="Couper le son">🔊</button>
      <button type="button" class="watch-btn watch-btn--play" id="watchPlay" aria-label="Lecture/Pause">▶</button>
      <button type="button" class="watch-btn watch-btn--small" id="watchShare" aria-label="Partager">🔗</button>
    </div>

    <div class="watch-volume" role="group" aria-label="Volume">
      <span aria-hidden="true">🔈</span>
      <input type="range" id="watchVol" min="0" max="1" step="0.01" value="1" aria-label="Volume" />
      <span aria-hidden="true">🔊</span>
    </div>

    <div class="watch-reactions" id="watchReactions" aria-label="Réactions">
      ${["🔥","❤️","🎉","🕺","💯","🤘"].map(e => `<button type="button" class="watch-react" data-emoji="${e}" aria-label="${e}">${e}</button>`).join("")}
    </div>

    <footer class="watch-bottom">
      <div class="watch-next" id="watchNext" hidden>
        <span class="watch-next-label">À SUIVRE</span>
        <span class="watch-next-time" id="watchNextTime">--:--</span>
        <span class="watch-next-title" id="watchNextTitle">—</span>
      </div>
      <p class="watch-hint">Esc pour fermer · Espace pour play/pause · M pour mute</p>
    </footer>`;
  document.body.appendChild(wm);

  const audio = getAudio();
  wm.querySelector(".watch-close").addEventListener("click", closeWatch);
  $("#watchPlay").addEventListener("click", () => {
    const a = getAudio();
    if (a?.paused) void startPlayback();
    else pausePlayback();
  });
  $("#watchMute").addEventListener("click", toggleMute);
  $("#watchShare").addEventListener("click", shareCurrent);
  $("#watchLyricsBtn").addEventListener("click", () => { try { toggleLyrics(); } catch { /* noop */ } });
  $("#watchPipBtn").addEventListener("click", () => { try { void togglePip(); } catch { /* noop */ } });
  const vol = $("#watchVol");
  if (vol && audio) {
    vol.value = String(audio.volume ?? 1);
    vol.addEventListener("input", () => {
      audio.volume = Number(vol.value);
      try { store.set(STORAGE.vol, vol.value); } catch { /* noop */ }
    });
  }
  $("#watchReactions").addEventListener("click", (e) => {
    const btn = e.target.closest(".watch-react");
    if (!btn) return;
    try { floatEmoji(btn.dataset.emoji, btn); } catch { /* noop */ }
    btn.classList.add("is-pop");
    setTimeout(() => btn.classList.remove("is-pop"), 250);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !wm.hidden) closeWatch();
  });
}

export function syncWatch() {
  const wm = $("#watchMode");
  if (!wm || wm.hidden) return;
  const slot = state.currentSlot || getCurrentSlot();
  $("#watchTitle").textContent = slot?.title || "En direct";
  $("#watchHost").textContent = slot?.host || "Programmation";
  const tag = SLOT_TAGS[slot?.tag] || SLOT_TAGS.hitlist;
  $("#watchTag").textContent = `LIVE · ${tag.label}`;
  $("#watchTag").style.color = tag.color;
  const trackEl = $("#watchTrack");
  if (state.currentTrack && state.currentTrack.title) {
    const label = state.currentTrack.artist ? `${state.currentTrack.artist} — ${state.currentTrack.title}` : state.currentTrack.title;
    trackEl.textContent = `♫ ${label}`;
    trackEl.hidden = false;
  } else {
    trackEl.hidden = true;
  }
  const cover = $("#watchCover");
  const backdrop = $("#watchBackdrop");
  if (state.currentCover) {
    cover.style.backgroundImage = `url("${state.currentCover}")`;
    cover.classList.add("has-img");
    if (backdrop) backdrop.style.backgroundImage = `url("${state.currentCover}")`;
  } else {
    cover.style.backgroundImage = "";
    cover.classList.remove("has-img");
    if (backdrop) backdrop.style.backgroundImage = "";
  }
  const playBtn = $("#watchPlay");
  const audio = getAudio();
  if (playBtn) {
    const playing = !audio?.paused;
    playBtn.textContent = playing ? "⏸" : "▶";
    wm.classList.toggle("is-playing", playing);
  }
  try {
    const next = getNextSlot();
    const nextWrap = $("#watchNext");
    if (next && nextWrap) {
      $("#watchNextTime").textContent = next.from || "";
      $("#watchNextTitle").textContent = next.title || "";
      nextWrap.hidden = false;
    } else if (nextWrap) {
      nextWrap.hidden = true;
    }
  } catch { /* noop */ }
  const clock = $("#watchClock");
  if (clock) {
    const fmt = () => {
      const d = new Date();
      clock.textContent = d.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Toronto" });
    };
    fmt();
    if (!_watchClockTimer) _watchClockTimer = setInterval(fmt, 30000);
  }
}

export function openWatch() {
  ensureWatchMode();
  const wm = $("#watchMode");
  wm.hidden = false;
  document.body.classList.add("watch-open");
  requestAnimationFrame(() => wm.classList.add("is-open"));
  syncWatch();
}

export function closeWatch() {
  const wm = $("#watchMode");
  if (!wm) return;
  wm.classList.remove("is-open");
  document.body.classList.remove("watch-open");
  if (_watchClockTimer) { clearInterval(_watchClockTimer); _watchClockTimer = 0; }
  setTimeout(() => { wm.hidden = true; }, 250);
}

export function injectWatchButton() {
  const header = $(".player-header");
  if (!header || $("#watchOpenBtn")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "watchOpenBtn";
  btn.className = "watch-open-btn";
  btn.title = "Mode plein écran";
  btn.setAttribute("aria-label", "Ouvrir le lecteur plein écran");
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
  btn.addEventListener("click", openWatch);
  header.appendChild(btn);
}

/* Branche le hook player → syncWatch dès l'import */
setWatchSyncHook(syncWatch);
