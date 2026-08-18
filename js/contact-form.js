/* Formulaire contact + autocomplete iTunes (combobox accessible) + suivi demandes. */

import { $, escapeHtml, clampString, fetchWithTimeout, NET_TIMEOUTS } from "./util.js";
import { toast } from "./toast.js";
import { API_BASE } from "./api-config.js";
import { BRAND } from "./brand.generated.js";
import { ensureClientId } from "./client-id.js";
import { rememberRequestId, refreshRequestTracker } from "./request-tracker.js";

function ensureFormLiveRegion(form) {
  let el = $("#contactFormLive", form);
  if (el) return el;
  el = document.createElement("div");
  el.id = "contactFormLive";
  el.className = "sr-only";
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-atomic", "true");
  form.prepend(el);
  return el;
}

function setFieldError(input, msg) {
  const label = input.closest("label");
  const errId = `${input.name || input.id}-error`;
  let err = label?.querySelector(".field-error");
  if (msg) {
    input.setAttribute("aria-invalid", "true");
    if (!err && label) {
      err = document.createElement("span");
      err.className = "field-error";
      err.id = errId;
      err.setAttribute("role", "alert");
      label.appendChild(err);
    }
    if (err) {
      if (!err.id) err.id = errId;
      err.textContent = msg;
    }
    input.setAttribute("aria-describedby", errId);
  } else {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
    err?.remove();
  }
}

function validateForm(form, fd) {
  let ok = true;
  const nom = (fd.get("nom") || "").toString().trim();
  const message = (fd.get("message") || "").toString().trim();
  const email = (fd.get("email") || "").toString().trim();
  const nomInput = form.querySelector('[name="nom"]');
  const msgInput = form.querySelector('[name="message"]');
  const emailInput = form.querySelector('[name="email"]');
  if (nom.length < 2) { setFieldError(nomInput, "Nom requis (2 caractères min.)"); ok = false; }
  else setFieldError(nomInput, "");
  if (message.length < 5) { setFieldError(msgInput, "Message requis (5 caractères min.)"); ok = false; }
  else setFieldError(msgInput, "");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFieldError(emailInput, "Courriel invalide");
    ok = false;
  } else setFieldError(emailInput, "");
  return ok;
}

export function bindContactForm() {
  const form = $("#contactForm");
  if (!form) return;
  const live = ensureFormLiveRegion(form);
  const trackInput = $("#trackQuery", form);
  const suggestList = $("#trackSuggest", form);
  let timer = 0;
  let activeIdx = -1;
  let suggestions = [];

  function closeSuggest() {
    suggestList.hidden = true;
    trackInput.setAttribute("aria-expanded", "false");
    trackInput.removeAttribute("aria-activedescendant");
    activeIdx = -1;
  }

  function renderSuggest(items) {
    suggestions = items;
    if (!items.length) { closeSuggest(); return; }
    suggestList.innerHTML = items.map((t, i) =>
      `<li role="option" id="track-opt-${i}" aria-selected="${i === activeIdx}">${escapeHtml(t)}</li>`).join("");
    suggestList.hidden = false;
    trackInput.setAttribute("aria-expanded", "true");
    if (activeIdx >= 0) {
      trackInput.setAttribute("aria-activedescendant", `track-opt-${activeIdx}`);
    } else {
      trackInput.removeAttribute("aria-activedescendant");
    }
  }

  function pickSuggestion(text) {
    trackInput.value = text;
    closeSuggest();
    trackInput.focus();
  }

  trackInput?.setAttribute("role", "combobox");
  trackInput?.setAttribute("aria-autocomplete", "list");
  trackInput?.setAttribute("aria-controls", "trackSuggest");
  trackInput?.setAttribute("aria-expanded", "false");

  trackInput?.addEventListener("input", () => {
    clearTimeout(timer);
    const q = trackInput.value.trim();
    if (q.length < 3) { closeSuggest(); return; }
    timer = window.setTimeout(async () => {
      try {
        const r = await fetchWithTimeout(`https://itunes.apple.com/search?media=music&entity=song&limit=6&term=${encodeURIComponent(q)}`, {}, NET_TIMEOUTS.cover);
        const data = await r.json();
        const items = (Array.isArray(data?.results) ? data.results : [])
          .map((x) => `${clampString(x?.artistName, 120)} — ${clampString(x?.trackName, 160)}`)
          .filter((s) => s.length > 3);
        activeIdx = items.length ? 0 : -1;
        renderSuggest(items);
      } catch { closeSuggest(); }
    }, 280);
  });

  trackInput?.addEventListener("keydown", (e) => {
    if (suggestList.hidden || !suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(suggestions.length - 1, activeIdx + 1);
      renderSuggest(suggestions);
      suggestList.querySelector(`#track-opt-${activeIdx}`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(0, activeIdx - 1);
      renderSuggest(suggestions);
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      pickSuggestion(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      closeSuggest();
    }
  });

  suggestList?.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    pickSuggestion(li.textContent || "");
  });

  document.addEventListener("click", (e) => {
    if (!form.contains(e.target)) closeSuggest();
  });

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
    location.href = `mailto:${to}?subject=${encodeURIComponent(`[${BRAND.name}] ${sujet}`)}&body=${encodeURIComponent(body)}`;
    live.textContent = "Ouverture de ton client courriel…";
    toast("Ouverture de ton client email…", "ok");
  }

  async function submitRequest(fd, track, honey, submitBtn) {
    const { artist, title } = splitTrack(track);
    if (!title) {
      live.textContent = "Précise un titre à demander.";
      toast("Précise un titre à demander", "warn");
      return;
    }
    const clientId = ensureClientId();
    if (!clientId) {
      live.textContent = "Stockage local requis pour envoyer une demande.";
      toast("Stockage local requis pour envoyer une demande", "error");
      return;
    }
    submitBtn.disabled = true;
    submitBtn.setAttribute("aria-busy", "true");
    submitBtn.dataset.label = submitBtn.textContent;
    submitBtn.textContent = "Envoi en cours…";
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
      const data = await r.json();
      if (data.id) rememberRequestId(data.id);
      live.textContent = "Demande envoyée au studio.";
      toast("Demande envoyée au studio ✓", "ok");
      form.reset();
      closeSuggest();
      void refreshRequestTracker();
    } catch {
      live.textContent = "Envoi impossible — ouverture du courriel.";
      toast("Envoi impossible — on ouvre ton courriel", "warn");
      openMailto(fd, fd.get("sujet") || "Demande de titre", track);
    } finally {
      submitBtn.disabled = false;
      submitBtn.removeAttribute("aria-busy");
      submitBtn.textContent = submitBtn.dataset.label || "📧 Envoyer";
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const honey = $("#hp_field", form);
    if (honey && honey.value) return;
    const fd = new FormData(form);
    const track = (fd.get("track") || "").toString().trim();
    const submitBtn = form.querySelector('[type="submit"]');
    if (track) {
      if (!validateForm(form, fd)) {
        live.textContent = "Corrige les champs en erreur.";
        return;
      }
      void submitRequest(fd, track, honey, submitBtn);
      return;
    }
    if (!validateForm(form, fd)) {
      live.textContent = "Corrige les champs en erreur.";
      return;
    }
    const sujet = fd.get("sujet") || `Message ${BRAND.name}`;
    openMailto(fd, sujet, track);
  });

  form.querySelectorAll("input, textarea, select").forEach((el) => {
    el.addEventListener("blur", () => {
      validateForm(form, new FormData(form));
    });
  });
}
