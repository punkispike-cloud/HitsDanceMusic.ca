/* En Ondes — page Pro : année du copyright (externalisé pour la CSP). */
(function () {
  var y = document.getElementById("y");
  if (y) y.textContent = new Date().getFullYear();
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
