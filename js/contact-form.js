/* Formulaire contact + autocomplete iTunes (demande de titre) + honeypot.
   Quand l'auditeur choisit un titre, la demande est poussée dans la file
   animateur (POST /v1/requests) au lieu d'ouvrir un mailto:. Sans titre, on
   garde le comportement mailto d'origine (message général / partenariat). */

import { $, escapeHtml, clampString, fetchWithTimeout, NET_TIMEOUTS } from "./util.js";
import { toast } from "./toast.js";
import { API_BASE } from "./api-config.js";

const CLIENT_KEY = "hr.clientId";

export function bindContactForm() {
  const form = $("#contactForm");
  if (!form) return;
  const trackInput = $("#trackQuery", form);
  const suggestList = $("#trackSuggest", form);
  const errorsBox = $("#contactErrors", form);
  let timer = 0;

  function fieldLabel(el) {
    const lbl = el.closest("label");
    const txt = lbl?.firstChild?.textContent?.trim();
    return txt || el.name || "Champ";
  }
  function clearFormErrors() {
    if (errorsBox) { errorsBox.hidden = true; errorsBox.textContent = ""; }
    form.querySelectorAll("[aria-invalid='true']").forEach((el) => el.removeAttribute("aria-invalid"));
  }
  function showFormErrors() {
    const invalid = Array.from(form.querySelectorAll("input,textarea,select")).filter(
      (el) => !el.checkValidity()
    );
    if (!invalid.length) { clearFormErrors(); return false; }
    invalid.forEach((el) => el.setAttribute("aria-invalid", "true"));
    const list = invalid.map(fieldLabel).filter(Boolean);
    if (errorsBox) {
      errorsBox.hidden = false;
      errorsBox.textContent = list.length
        ? `À compléter : ${list.join(", ")}.`
        : "Certains champs sont incomplets.";
    }
    form.reportValidity(); // garde les bulles natives en complément
    invalid[0].focus();
    return true;
  }
  form.addEventListener("input", () => { if (errorsBox && !errorsBox.hidden) clearFormErrors(); });

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

  /* Même UUID stable que presence/analytics (localStorage hr.clientId). Si
     absent, on en génère un et on le pose (corrélation avec les autres flux). */
  function ensureClientId() {
    try {
      let id = localStorage.getItem(CLIENT_KEY);
      if (id) return id;
      id = crypto.randomUUID();
      try { localStorage.setItem(CLIENT_KEY, id); } catch { /* mode privé */ }
      return id;
    } catch {
      return crypto.randomUUID();
    }
  }

  /* L'autocomplete iTunes produit « Artiste — Titre » (em dash). On sépare sur
     le 1er séparateur trouvé ; sans séparateur, tout va dans le titre. */
  function splitTrack(s) {
    const em = s.indexOf(" — ");
    if (em > 0) return { artist: s.slice(0, em).trim(), title: s.slice(em + 3).trim() };
    const hy = s.indexOf(" - ");
    if (hy > 0) return { artist: s.slice(0, hy).trim(), title: s.slice(hy + 3).trim() };
    return { artist: "", title: s.trim() };
  }

  function openMailto(fd, sujet, track) {
    const body = [
      `Nom : ${fd.get("nom") || ""}`,
      `Email : ${fd.get("email") || ""}`,
      `Sujet : ${sujet}`,
      `Demande de titre : ${track || "—"}`,
      "",
      String(fd.get("message") || ""),
    ].join("\n");
    const to = form.dataset.mail || "studio@hit.radio";
    location.href = `mailto:${to}?subject=${encodeURIComponent("[Hits Dance Music] " + sujet)}&body=${encodeURIComponent(body)}`;
    toast("Ouverture de ton client email…", "ok");
  }

  async function submitRequest(fd, track, honey) {
    const { artist, title } = splitTrack(track);
    if (!title) { toast("Précise un titre à demander", "warn"); return; }
    const clientId = ensureClientId();
    if (!clientId) { toast("Stockage local requis pour envoyer une demande", "error"); return; }
    try {
      const r = await fetchWithTimeout(`${API_BASE}/v1/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          artist,
          title,
          dedication: (fd.get("message") || "").toString().trim() || null,
          requesterName: (fd.get("nom") || "").toString().trim() || null,
          _hp: honey ? honey.value : "",
        }),
      }, NET_TIMEOUTS.generic);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast("Demande envoyée au studio ✓", "ok");
      form.reset();
      suggestList.hidden = true;
    } catch {
      // Repli gracieux : si l'API est injoignable, on ouvre le courriel.
      toast("Envoi impossible — on ouvre ton courriel", "warn");
      openMailto(fd, fd.get("sujet") || "Demande de titre", track);
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const honey = $("#hp_field", form);
    if (honey && honey.value) return; // honeypot : bot → on sort sans rien faire
    const fd = new FormData(form);
    const track = (fd.get("track") || "").toString().trim();
    // Un titre est choisi → demande dans la file animateur (pas de mailto).
    if (track) {
      void submitRequest(fd, track, honey);
      return;
    }
    // Pas de titre → message général → on valide puis on ouvre le courriel.
    if (!form.checkValidity()) { showFormErrors(); return; }
    clearFormErrors();
    const sujet = fd.get("sujet") || "Message Hits Dance Music";
    openMailto(fd, sujet, track);
  });
}
