/* Bootstrap thème — exécuté avant le rendu pour éviter le FOUC.
   Lit hr.theme (auto|light|dark) et fixe data-theme + theme-color.
   Externalisé du <script> inline pour pouvoir supprimer
   'unsafe-inline' de la CSP script-src. */
(function () {
  try {
    var m = localStorage.getItem("hr.theme") || "auto";
    var r = (m === "light" || m === "dark")
      ? m
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.theme = r;
    document.documentElement.dataset.themeMode = m;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = (r === "light" ? "#fafafa" : "#0f0f12");
  } catch (e) { /* localStorage indisponible (mode privé) → ignoré */ }
})();
