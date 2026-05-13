/* Countdown vers le prochain show (affiché dans le player). */

import { $, escapeHtml } from "./util.js";
import { getMontrealParts, toMinutes } from "./time.js";
import { getNextSlot } from "./schedule.js";

export function renderCountdown() {
  const el = $("#nextShowCountdown");
  if (!el) return;
  const next = getNextSlot();
  if (!next) { el.hidden = true; return; }
  el.hidden = false;
  const { hour, minute } = getMontrealParts();
  const nowMin = hour * 60 + minute;
  const fromMin = toMinutes(next.from);
  let mins = next.sameDay ? (fromMin - nowMin) : ((24 * 60 - nowMin) + fromMin);
  if (mins < 0) mins = 0;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const when = h > 0 ? `${h} h ${String(m).padStart(2,"0")}` : `${m} min`;
  el.innerHTML = `<span class="countdown-kicker">Prochain :</span> <strong>${escapeHtml(next.title)}</strong> <span class="countdown-time">dans ${when}${next.sameDay ? "" : " (demain)"}</span>`;
}
