/* Minuteur de sommeil : compte à rebours, badge dans le header, menu d'options. */

import { $ } from "./util.js";
import { pausePlayback } from "./player.js";
import { toast } from "./toast.js";

let sleepTimerId = 0;
let sleepEndsAt = 0;
let sleepTickId = 0;

export function startSleepTimer(minutes) {
  cancelSleepTimer(true);
  if (!minutes || minutes <= 0) return;
  sleepEndsAt = Date.now() + minutes * 60_000;
  sleepTimerId = window.setTimeout(() => {
    pausePlayback();
    toast("Minuteur écoulé — radio en pause. Bonne nuit ! 🌙", "ok", 5000);
    cancelSleepTimer(true);
  }, minutes * 60_000);
  sleepTickId = window.setInterval(updateSleepBadge, 1000);
  updateSleepBadge();
  toast(`Minuteur réglé : ${minutes} min`, "ok");
}

export function cancelSleepTimer(silent = false) {
  if (sleepTimerId) clearTimeout(sleepTimerId);
  if (sleepTickId) clearInterval(sleepTickId);
  sleepTimerId = 0; sleepEndsAt = 0; sleepTickId = 0;
  updateSleepBadge();
  if (!silent) toast("Minuteur annulé", "info");
}

function updateSleepBadge() {
  const badge = $("#sleepBadge");
  if (!badge) return;
  if (!sleepEndsAt) { badge.hidden = true; return; }
  badge.hidden = false;
  const left = Math.max(0, sleepEndsAt - Date.now());
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  badge.textContent = `🌙 ${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function ensureSleepMenu() {
  if ($("#sleepMenu")) return;
  const wrap = document.createElement("div");
  wrap.id = "sleepMenu";
  wrap.className = "sleep-menu";
  wrap.hidden = true;
  wrap.setAttribute("role", "menu");
  wrap.innerHTML = `
    <button type="button" data-min="15" role="menuitem">15 min</button>
    <button type="button" data-min="30" role="menuitem">30 min</button>
    <button type="button" data-min="45" role="menuitem">45 min</button>
    <button type="button" data-min="60" role="menuitem">1 h</button>
    <button type="button" data-min="90" role="menuitem">1 h 30</button>
    <button type="button" data-min="120" role="menuitem">2 h</button>
    <button type="button" data-min="0" role="menuitem" class="sleep-cancel">Annuler</button>`;
  document.body.appendChild(wrap);
  wrap.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const min = Number(b.dataset.min);
    if (min === 0) cancelSleepTimer();
    else startSleepTimer(min);
    wrap.hidden = true;
  });
  document.addEventListener("click", (e) => {
    if (wrap.hidden) return;
    if (e.target.closest("#sleepBtn") || e.target.closest("#sleepMenu") || e.target.closest("#mi_sleepBtn")) return;
    wrap.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !wrap.hidden) wrap.hidden = true;
  });
}

export function toggleSleepMenu(anchor) {
  ensureSleepMenu();
  const menu = $("#sleepMenu");
  if (menu.hidden) {
    const r = anchor.getBoundingClientRect();
    let top = r.bottom + 8;
    let left = Math.max(8, Math.min(window.innerWidth - 200, r.left));
    if (r.width === 0 && r.height === 0) {
      top = 64; left = window.innerWidth - 200;
    }
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.hidden = false;
  } else {
    menu.hidden = true;
  }
}
