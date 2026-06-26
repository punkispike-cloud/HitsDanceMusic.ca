/* En Ondes — Hub : enregistrement du service worker (PWA).
   Uniquement en contexte sécurisé (https) ou localhost. Non bloquant. */
(function () {
  if (!("serviceWorker" in navigator)) return;
  var ok = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!ok) return;
  // Recharge une fois quand une MISE À JOUR du SW prend la main. Garde-fou : on
  // n'attache l'écouteur que s'il y a DÉJÀ un contrôleur (sinon la 1re visite —
  // où clients.claim() prend la main — déclencherait un rechargement inutile).
  if (navigator.serviceWorker.controller) {
    var refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function (err) {
      console.warn("[hub] SW non enregistré:", err && err.message);
    });
  });
})();
