/* En Ondes — page Pro : année du copyright (externalisé pour la CSP). */
(function () {
  var y = document.getElementById("y");
  if (y) y.textContent = new Date().getFullYear();
})();

/* CTA « Réserver un appel » : URL configurable en un seul endroit.
   ← REMPLACER RDV_URL par ton lien Calendly/Cal.com réel (décision ops/marketing).
   Par défaut : repli mailto FONCTIONNEL (pas de lien mort tant que le Calendly n'existe pas).
   Un lien http(s) ouvre un nouvel onglet ; un mailto ouvre le client courriel. */
(function () {
  var RDV_URL = "mailto:bonjour@enondes.ca?subject=Proposition%20radio%20%E2%80%94%20r%C3%A9server%20un%20appel";
  var btn = document.getElementById("rdv-btn");
  if (btn) {
    btn.setAttribute("href", RDV_URL);
    if (/^https?:/i.test(RDV_URL)) {
      btn.setAttribute("target", "_blank");
      btn.setAttribute("rel", "noopener");
    } else {
      btn.removeAttribute("target");
      btn.removeAttribute("rel");
    }
  }
})();

/* Révélation au défilement (amélioration progressive) : sans JS ou en
   mouvement réduit, le contenu s'affiche normalement — on n'ajoute la classe
   .reveal (qui masque puis révèle) que si l'effet est pertinent et supporté. */
(function () {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("IntersectionObserver" in window)) return;
  var targets = document.querySelectorAll(
    ".card, .step, .price, .founder, .tbl-wrap, .guar li, section > .wrap > h2"
  );
  if (!targets.length) return;
  targets.forEach(function (el) { el.classList.add("reveal"); });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-revealed");
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  targets.forEach(function (el) { io.observe(el); });
})();
