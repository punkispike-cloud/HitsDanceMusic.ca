/* Sticky bottom nav (mobile). */

import { $, $$ } from "./util.js";
import { getAudio, startPlayback } from "./player.js";
import { openSearch } from "./search-palette.js";

export function injectBottomNav() {
  if ($("#bottomNav")) return;
  const nav = document.createElement("nav");
  nav.id = "bottomNav";
  nav.className = "bottom-nav";
  nav.setAttribute("aria-label", "Navigation rapide");
  const path = location.pathname.split("/").pop() || "index.html";
  const items = [
    { href: "index.html", label: "Accueil", icon: '<path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/>' },
    { href: "#player",    label: "Direct",  icon: '<polygon points="6 4 20 12 6 20 6 4"/>', action: "play" },
    { href: "horaire.html", label: "Grille", icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
    { href: "emissions.html", label: "Shows", icon: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>' },
    { href: "#more",      label: "Plus",    icon: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>', action: "more" },
  ];
  nav.innerHTML = items.map((it) => {
    const active = it.href === path || (it.href === "index.html" && (path === "" || path === "index.html"));
    return `<a class="bn-item${active ? " is-active" : ""}" href="${it.href}" data-action="${it.action || ""}">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${it.icon}</svg>
      <span>${it.label}</span>
    </a>`;
  }).join("");
  document.body.appendChild(nav);
  document.body.classList.add("has-bottom-nav");

  $$(".bn-item", nav).forEach((a) => {
    a.addEventListener("click", (e) => {
      const action = a.dataset.action;
      if (action === "play") {
        e.preventDefault();
        $("#player")?.scrollIntoView({ behavior: "smooth", block: "center" });
        const audio = getAudio();
        if (audio?.paused) void startPlayback();
      } else if (action === "more") {
        e.preventDefault();
        openSearch();
      }
    });
  });
}
