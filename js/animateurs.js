/* Page animateurs : annote chaque carte avec "Prochain passage". */

import { $$, escapeHtml } from "./util.js";
import { findNextSlotForHost, SLOT_TAGS } from "./schedule.js";
import { DAY_NAMES } from "./time.js";

export function annotateTalentCards() {
  const cards = $$(".talent-card");
  if (!cards.length) return;
  cards.forEach((card) => {
    const name = card.querySelector("p")?.textContent?.trim() || "";
    if (!name) return;
    const next = findNextSlotForHost(name);
    if (!next) return;
    if (card.querySelector(".talent-next")) return;
    const tag = SLOT_TAGS[next.tag] || SLOT_TAGS.hitlist;
    const el = document.createElement("p");
    el.className = "talent-next";
    el.innerHTML = `<span class="talent-next-dot" style="background:${tag.color}"></span>Prochain : <strong>${DAY_NAMES[next.day]} ${next.from}</strong> — ${escapeHtml(next.title)}`;
    card.appendChild(el);
  });
}
