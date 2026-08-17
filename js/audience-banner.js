/* Bannière de mention « mesure d'audience » (Loi 25) — script externalisé
   (CSP script-src 'self' : aucun script inline autorisé).
   Mention d'information dismissible, persistée en localStorage (audience-ack).
   La collecte elle-même est gatée par le consentement (js/consent.js) — cette
   bannière informe, elle ne consent pas. Chargée en defer par le partial
   _partials/audience-banner.html sur toutes les pages sauf confidentialite/404. */
(function () {
  const b = document.getElementById("audience-banner");
  if (!b) return;
  try {
    if (localStorage.getItem("audience-ack")) {
      b.remove();
      return;
    }
  } catch (e) {
    /* localStorage indisponible (mode privé) : on affiche la mention. */
  }
  b.removeAttribute("hidden");
  const c = document.getElementById("audience-banner-close");
  if (c) {
    c.addEventListener("click", function () {
      try {
        localStorage.setItem("audience-ack", "1");
      } catch (e) {
        /* tant pis : la mention réapparaîtra à la prochaine visite. */
      }
      b.remove();
    });
  }
})();
