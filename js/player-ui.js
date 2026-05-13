/* UI player : panneau plein (#player) + mini-player flottant + header play
   + sleep badge. Les UI s'enregistrent dans playerUIs (Set) du module player. */

import { $, $$ } from "./util.js";
import { state } from "./state.js";
import { SLOT_TAGS } from "./schedule.js";
import {
  playerUIs, togglePlayback, setVolume, toggleMute,
} from "./player.js";
import { fallbackCoverDataUri } from "./now-playing.js";

/* ----- Panneau plein (#player) ----- */
export function makeFullPanelUI() {
  const panel = $("#player");
  if (!panel) return null;
  const playBtn = $("#playToggle", panel);
  const status = $("#playerStatus", panel);
  const vol = $("#volumeControl", panel);
  const cover = $("#onAirCover", panel);
  const titleEl = $("#onAirTitle", panel);
  const hostEl = $("#onAirHost", panel);
  const slotEl = $("#onAirSlot", panel);
  const tagEl = $("#onAirTag", panel);
  const trackLine = $("#liveTrackLine", panel);
  const trackText = $("#liveTrackText", panel);

  let muteBtn = $("#muteToggle", panel);
  if (!muteBtn && vol) {
    muteBtn = document.createElement("button");
    muteBtn.type = "button";
    muteBtn.id = "muteToggle";
    muteBtn.className = "icon-btn mute-btn";
    muteBtn.setAttribute("aria-label", "Couper le son");
    muteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
    vol.parentElement?.insertBefore(muteBtn, vol.parentElement.firstChild);
    muteBtn.addEventListener("click", toggleMute);
  }

  playBtn?.addEventListener("click", (e) => { e.preventDefault(); void togglePlayback(); });
  vol?.addEventListener("input", (e) => setVolume(Number(e.target.value)));

  return {
    syncVolume(v, muted) {
      if (vol) {
        vol.value = String(v);
        const ratio = muted ? 0 : v;
        vol.style.setProperty("--vol-fill", `${Math.round(ratio * 100)}%`);
        vol.style.setProperty("--vol-pos", String(ratio));
      }
      muteBtn?.classList.toggle("is-muted", muted);
      muteBtn?.setAttribute("aria-label", muted ? "Activer le son" : "Couper le son");
    },
    setState(isPlaying, label) {
      if (playBtn) {
        playBtn.classList.toggle("is-playing", isPlaying);
        playBtn.setAttribute("aria-label", isPlaying ? "Mettre la radio en pause" : "Lancer la radio");
        playBtn.dataset.state = isPlaying ? "playing" : "paused";
      }
      if (status && label) status.textContent = label;
      panel.classList.toggle("is-playing", isPlaying);
      if (cover) {
        const loading = !isPlaying && /tampon|connexion/i.test(label || "");
        cover.classList.toggle("is-loading", loading);
      }
    },
    syncSlot(slot) {
      const tag = SLOT_TAGS[slot.tag] || SLOT_TAGS.hitlist;
      if (titleEl) titleEl.textContent = slot.title;
      if (hostEl) hostEl.textContent = slot.host;
      if (slotEl) slotEl.textContent = `${slot.from} – ${slot.to}`;
      if (tagEl) {
        tagEl.textContent = tag.label;
        tagEl.style.setProperty("--tag-color", tag.color);
      }
      if (cover && !cover.dataset.live) {
        cover.src = fallbackCoverDataUri(slot);
        cover.alt = `Pochette — ${slot.title}`;
      }
    },
    syncTrack(track, coverUrl) {
      if (!trackLine || !trackText) return;
      if (!track) {
        trackLine.hidden = true;
        if (cover) delete cover.dataset.live;
        if (state.currentSlot) this.syncSlot(state.currentSlot);
        return;
      }
      trackLine.hidden = false;
      trackText.textContent = track.artist ? `${track.artist} — ${track.title}` : track.title;
      if (cover && coverUrl) {
        cover.dataset.live = "1";
        cover.src = coverUrl;
        cover.alt = `Pochette — ${track.title}`;
      }
    },
  };
}

/* ----- Mini-player flottant (injecté en bas) ----- */
// historyHook / shareHook : injectés par main.js pour éviter import cyclique
let _historyHook = () => {};
let _shareHook = () => {};
export function setMiniHooks({ openHistory, share }) {
  if (openHistory) _historyHook = openHistory;
  if (share) _shareHook = share;
}

export function makeMiniPlayerUI() {
  if ($("#miniPlayer")) return null;
  const bar = document.createElement("aside");
  bar.id = "miniPlayer";
  bar.className = "mini-player";
  bar.setAttribute("aria-label", "Lecteur radio Hits Dance Music");
  bar.innerHTML = `
    <button class="mini-play" id="miniPlay" type="button" aria-label="Lancer la radio" data-state="paused">
      <span class="mini-play-icon" aria-hidden="true"></span>
    </button>
    <div class="mini-meta">
      <span class="mini-show" id="miniShow">Hits Dance Music</span>
      <span class="mini-track" id="miniTrack">Les Hits Dance Music</span>
      <span class="mini-session" id="sessionBadgeMini" hidden></span>
    </div>
    <div class="mini-controls">
      <button class="mini-icon-btn" id="miniMute" type="button" aria-label="Couper le son" title="Muet (M)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
      </button>
      <input class="mini-volume" id="miniVolume" type="range" min="0" max="1" step="0.01" value="0.85" aria-label="Volume" />
      <button class="mini-icon-btn" id="miniHistoryBtn" type="button" aria-label="Historique des morceaux" title="Historique (H)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>
      </button>
      <button class="mini-icon-btn" id="miniShareBtn" type="button" aria-label="Partager" title="Partager">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
      </button>
      <button class="mini-icon-btn mini-close" id="miniClose" type="button" aria-label="Masquer le lecteur" title="Masquer">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
      </button>
    </div>`;
  document.body.appendChild(bar);

  const playBtn = $("#miniPlay", bar);
  const showEl = $("#miniShow", bar);
  const trackEl = $("#miniTrack", bar);
  const muteBtn = $("#miniMute", bar);
  const volEl = $("#miniVolume", bar);
  const histBtn = $("#miniHistoryBtn", bar);
  const shareBtn = $("#miniShareBtn", bar);
  const closeBtn = $("#miniClose", bar);

  playBtn.addEventListener("click", () => void togglePlayback());
  muteBtn.addEventListener("click", toggleMute);
  volEl.addEventListener("input", (e) => setVolume(Number(e.target.value)));
  histBtn.addEventListener("click", () => _historyHook());
  shareBtn.addEventListener("click", () => _shareHook());
  closeBtn.addEventListener("click", () => {
    bar.classList.add("is-hidden");
    sessionStorage.setItem("hr.miniHidden", "1");
  });

  // Sur l'accueil, le mini-player ne s'affiche que quand le grand player sort de l'écran
  const fullPanel = $("#player");
  if (fullPanel) {
    bar.classList.add("auto-hide");
    const io = new IntersectionObserver(
      ([entry]) => { bar.classList.toggle("is-shown", !entry.isIntersecting); },
      { threshold: 0.05 }
    );
    io.observe(fullPanel);
  } else {
    if (sessionStorage.getItem("hr.miniHidden") !== "1") bar.classList.add("is-shown");
  }

  return {
    syncVolume(v, muted) {
      volEl.value = String(v);
      volEl.style.setProperty("--vol-fill", `${Math.round((muted ? 0 : v) * 100)}%`);
      muteBtn.classList.toggle("is-muted", muted);
      muteBtn.setAttribute("aria-label", muted ? "Activer le son" : "Couper le son");
    },
    setState(isPlaying, label) {
      playBtn.classList.toggle("is-playing", isPlaying);
      playBtn.dataset.state = isPlaying ? "playing" : "paused";
      playBtn.setAttribute("aria-label", isPlaying ? "Mettre la radio en pause" : "Lancer la radio");
      bar.classList.toggle("is-loading", label === "Mise en mémoire tampon…" || label === "Connexion au direct…");
    },
    syncSlot(slot) {
      showEl.textContent = slot.title;
      if (!state.currentTrack) trackEl.textContent = slot.host || "Programmation";
    },
    syncTrack(track) {
      if (!track) return;
      trackEl.textContent = track.artist ? `${track.artist} — ${track.title}` : track.title;
    },
  };
}

/* ----- Header play button (toutes pages) ----- */
export function injectHeaderPlay() {
  const header = document.querySelector(".site-header");
  if (!header || document.getElementById("headerPlay")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "headerPlay";
  btn.className = "header-play btn-play";
  btn.setAttribute("aria-label", "Lancer la radio");
  btn.dataset.state = "paused";
  btn.innerHTML = `
    <span class="hp-ico hp-ico--play" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
    <span class="hp-ico hp-ico--pause" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg></span>
    <span class="hp-pulse" aria-hidden="true"></span>
    <span class="hp-label">Écouter</span>
  `;
  const navToggle = header.querySelector(".nav-toggle");
  if (navToggle) header.insertBefore(btn, navToggle);
  else header.appendChild(btn);
  btn.addEventListener("click", (e) => { e.preventDefault(); void togglePlayback(); });
}

/* ----- Sleep badge (placeholder texte mis à jour par sleep.js) ----- */
export function injectSleepBadge() {
  const tools = $(".site-header .header-tools");
  if (!tools || $("#sleepBadge")) return;
  const badge = document.createElement("span");
  badge.id = "sleepBadge";
  badge.className = "sleep-badge";
  badge.hidden = true;
  tools.insertBefore(badge, tools.firstChild);
}

/* ----- Badge "Tu écoutes depuis…" dans le panneau plein ----- */
export function injectSessionBadgeHost() {
  const fullPanel = document.getElementById("player");
  if (!fullPanel || document.getElementById("sessionBadgeFull")) return;
  const b = document.createElement("p");
  b.id = "sessionBadgeFull";
  b.className = "session-badge";
  b.hidden = true;
  fullPanel.appendChild(b);
}
