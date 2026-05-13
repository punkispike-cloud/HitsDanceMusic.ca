/* Formulaire contact + autocomplete iTunes (demande de titre) + honeypot. */

import { $, escapeHtml, clampString, fetchWithTimeout, NET_TIMEOUTS } from "./util.js";
import { toast } from "./toast.js";

export function bindContactForm() {
  const form = $("#contactForm");
  if (!form) return;
  const trackInput = $("#trackQuery", form);
  const suggestList = $("#trackSuggest", form);
  let timer = 0;

  trackInput?.addEventListener("input", () => {
    clearTimeout(timer);
    const q = trackInput.value.trim();
    if (q.length < 3) { suggestList.innerHTML = ""; suggestList.hidden = true; return; }
    timer = window.setTimeout(async () => {
      try {
        const r = await fetchWithTimeout(`https://itunes.apple.com/search?media=music&entity=song&limit=5&term=${encodeURIComponent(q)}`, {}, NET_TIMEOUTS.cover);
        const data = await r.json();
        const items = (Array.isArray(data?.results) ? data.results : [])
          .map((x) => `${clampString(x?.artistName, 120)} — ${clampString(x?.trackName, 160)}`)
          .filter((s) => s.length > 3);
        if (!items.length) { suggestList.hidden = true; return; }
        suggestList.innerHTML = items.map((t) => `<li role="option">${escapeHtml(t)}</li>`).join("");
        suggestList.hidden = false;
      } catch { suggestList.hidden = true; }
    }, 280);
  });
  suggestList?.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    trackInput.value = li.textContent || "";
    suggestList.hidden = true;
  });

  form.addEventListener("submit", (e) => {
    const honey = $("#hp_field", form);
    if (honey && honey.value) { e.preventDefault(); return; }
    if (!form.checkValidity()) { e.preventDefault(); form.reportValidity(); return; }
    e.preventDefault();
    const fd = new FormData(form);
    const sujet = fd.get("sujet") || "Message Hits Dance Music";
    const body = [
      `Nom : ${fd.get("nom") || ""}`,
      `Email : ${fd.get("email") || ""}`,
      `Sujet : ${sujet}`,
      `Demande de titre : ${fd.get("track") || "—"}`,
      "",
      String(fd.get("message") || ""),
    ].join("\n");
    const to = form.dataset.mail || "studio@hit.radio";
    location.href = `mailto:${to}?subject=${encodeURIComponent("[Hits Dance Music] " + sujet)}&body=${encodeURIComponent(body)}`;
    toast("Ouverture de ton client email…", "ok");
  });
}
