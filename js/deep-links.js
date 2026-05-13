/* Deep link ?show=slug : ouvre + scroll vers la fiche émission. */

import { $$ } from "./util.js";

export function handleDeepLinks() {
  const params = new URLSearchParams(location.search);
  const slug = params.get("show");
  if (!slug) return;
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-");
  const cards = $$(".show-detail");
  for (const card of cards) {
    const title = card.querySelector("h3")?.textContent || "";
    if (norm(title) === slug || norm(title).includes(slug)) {
      card.classList.add("is-highlighted");
      requestAnimationFrame(() => card.scrollIntoView({ behavior: "smooth", block: "center" }));
      setTimeout(() => card.classList.remove("is-highlighted"), 4000);
      break;
    }
  }
}
