/* Bootstrap thème — exécuté avant le rendu pour éviter le FOUC.
   L'app est verrouillée en mode sombre : pas de toggle, pas de "auto",
   pas de suivi des préférences système. Le charme visuel de la radio
   repose sur le dark. */
(function () {
  document.documentElement.dataset.theme = "dark";
  document.documentElement.dataset.themeMode = "dark";
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = "#0f0f12";
  try { localStorage.removeItem("hr.theme"); } catch (e) { /* mode privé → ignoré */ }
})();
