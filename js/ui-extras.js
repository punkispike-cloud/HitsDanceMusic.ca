/* UX extras : ticker, back-to-top, scroll-reveal, skeletons. */
   + initPhase2UX (swipe mini, double-tap mute, open now-drawer). */

import { $, $$ } from "./util.js";
import { state } from "./state.js";
import { getCurrentSlot } from "./schedule.js";
import { toggleMute } from "./player.js";
import { toast } from "./toast.js";
import { openNowPlayingDrawer } from "./now-drawer.js";
import { BRAND } from "./brand.generated.js";

/* ----- Ticker EN DIRECT — actualisé toutes les 15 s ----- */
function refreshTicker() {
  const txt = document.querySelector("#hrTickerTrack .hr-ticker-text");
  if (!txt) return;
  const slot = state.currentSlot || getCurrentSlot();
  const parts = ["EN DIRECT"];
  if (slot?.title) parts.push(slot.title);
  if (slot?.host) parts.push(slot.host);
  if (state.currentTrack) {
    const tk = state.currentTrack.artist ? `${state.currentTrack.artist} — ${state.currentTrack.title}` : state.currentTrack.title;
    parts.push(`Maintenant : ${tk}`);
  }
  const line = parts.join(" · ");
  txt.textContent = `${line}     ★     ${line}     ★     ${line}`;
  requestAnimationFrame(() => {
    const track = document.getElementById("hrTickerTrack");
    if (!track) return;
    const distance = track.scrollWidth + window.innerWidth;
    const pxPerSec = window.matchMedia("(max-width: 760px)").matches ? 55 : 70;
    const duration = Math.max(30, Math.round(distance / pxPerSec));
    track.style.animationDuration = `${duration}s`;
  });
}

function injectTicker() {
  if (document.getElementById("hrTicker")) return;
  const header = document.querySelector(".site-header");
  // Sans .site-header la ligne rouge « EN DIRECT » ne peut pas s'ancrer
  // (offset CSS du header). On n'injecte pas en orphelin.
  if (!header?.parentElement) return;
  const t = document.createElement("div");
  t.id = "hrTicker";
  t.className = "hr-ticker";
  t.setAttribute("aria-live", "off");
  t.innerHTML = `<div class="hr-ticker-track" id="hrTickerTrack">
    <span class="hr-ticker-dot" aria-hidden="true"></span>
    <span class="hr-ticker-text">EN DIRECT — ${BRAND.name} · La radio</span>
  </div>`;
  // Avant le header : empilement ticker (z-index 60) + header décalé de --hr-ticker-h.
  header.parentElement.insertBefore(t, header);
  refreshTicker();
  setInterval(refreshTicker, 15_000);
}

function injectBackToTop() {
  if (document.getElementById("backToTop")) return;
  const btn = document.createElement("button");
  btn.id = "backToTop";
  btn.type = "button";
  btn.className = "back-to-top";
  btn.setAttribute("aria-label", "Retour en haut");
  btn.title = "Retour en haut";
  btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>`;
  btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  document.body.appendChild(btn);
  const onScroll = () => btn.classList.toggle("is-shown", window.scrollY > 600);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function extendScrollReveal() {
  const sel = ".featured-card, .partner-card, .stream-chip, .requests-card, .rail-card, .show-card, .talent-card, .quick-strip-card, .news-card";
  const targets = document.querySelectorAll(sel);
  if (!targets.length || !("IntersectionObserver" in window)) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add("hr-reveal-in");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });
  targets.forEach((el, i) => {
    if (el.classList.contains("hr-reveal-in")) return;
    el.classList.add("hr-reveal");
    el.style.setProperty("--reveal-delay", `${Math.min(i * 40, 320)}ms`);
    io.observe(el);
  });
}

function applyMetaSkeletons() {
  const targets = ["#onAirTitle", "#onAirHost", "#liveTrackText", "#miniTrack"];
  targets.forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const txt = (el.textContent || "").trim();
    if (!txt || txt === "—" || txt === "..." || txt === "…") {
      el.classList.add("is-skeleton");
      el.textContent = "";
    }
    const mo = new MutationObserver(() => {
      const v = (el.textContent || "").trim();
      if (v && v !== "—" && v !== "...") el.classList.remove("is-skeleton");
    });
    mo.observe(el, { childList: true, characterData: true, subtree: true });
  });
}

export function initUiExtras() {
  injectTicker();
  injectBackToTop();
  extendScrollReveal();
  applyMetaSkeletons();
}

/* ----- Phase 2 UX : swipe mini-player + double-tap mute ----- */
export function initPhase2UX() {
  const mini = document.getElementById("miniPlayer");
  if (mini) {
    let startY = 0, startX = 0, dragging = false;
    mini.addEventListener("touchstart", (e) => {
      if (e.target.closest("button, input")) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      dragging = true;
      mini.style.transition = "none";
    }, { passive: true });
    mini.addEventListener("touchmove", (e) => {
      if (!dragging) return;
      const dy = e.touches[0].clientY - startY;
      const dx = Math.abs(e.touches[0].clientX - startX);
      if (dy > 10 && dx < 40) {
        mini.style.transform = `translateY(${Math.min(dy, 140)}px)`;
        mini.style.opacity = String(Math.max(0.3, 1 - dy / 200));
      }
    }, { passive: true });
    mini.addEventListener("touchend", (e) => {
      if (!dragging) return;
      dragging = false;
      mini.style.transition = "";
      const dy = (e.changedTouches[0]?.clientY ?? 0) - startY;
      mini.style.transform = "";
      mini.style.opacity = "";
      if (dy > 80) {
        mini.classList.add("is-hidden");
        mini.classList.remove("is-shown");
        sessionStorage.setItem("hr.miniHidden", "1");
        toast("Lecteur masqué — touche P pour le rappeler", "info");
      }
    });
  }

  const cover = document.querySelector(".player-cover");
  if (cover) {
    let lastTap = 0;
    cover.addEventListener("click", (e) => {
      const now = Date.now();
      if (now - lastTap < 320) {
        e.preventDefault();
        toggleMute();
        cover.classList.add("just-muted");
        setTimeout(() => cover.classList.remove("just-muted"), 600);
        lastTap = 0;
        return;
      }
      lastTap = now;
      setTimeout(() => {
        if (lastTap && Date.now() - lastTap >= 300) {
          openNowPlayingDrawer();
          lastTap = 0;
        }
      }, 320);
    });
    cover.style.cursor = "pointer";
    cover.setAttribute("title", "Cliquer : agrandir — Double-clic : muet");
  }
}
