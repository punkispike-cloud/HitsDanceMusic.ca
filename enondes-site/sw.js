/* En Ondes — Hub : service worker (PWA installable + offline léger).
 *
 * Stratégie :
 *   - precache du shell (tolérant aux fichiers manquants) ;
 *   - navigations : réseau d'abord, repli sur index.html en cache hors-ligne ;
 *   - assets same-origin : stale-while-revalidate ;
 *   - JAMAIS de cache pour /np/* (now-playing, temps réel), les flux audio
 *     (cross-origin, donc non interceptés) ni les requêtes Range.
 */
const VERSION = "eo-hub-v7";
const SHELL = [
  "./",
  "./index.html",
  "./pro.html",
  "./hub.css",
  "./hub.js",
  "./sw-register.js",
  "./pro.js",
  "./stations.json",
  "./manifest.webmanifest",
  "./assets/favicon.svg",
  "./assets/studio-bg.jpg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png",
  "./assets/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Same-origin uniquement (les flux audio cross-origin passent tout droit).
  if (url.origin !== self.location.origin) return;
  // Now-playing : toujours réseau (temps réel), jamais en cache.
  if (url.pathname.startsWith("/np/") || url.pathname === "/np") return;
  // Requêtes Range (audio/seek) : ne pas intercepter.
  if (req.headers.has("range")) return;

  // Shell (navigations + html/css/js/json/manifest) : RÉSEAU D'ABORD → jamais
  // de version périmée. Repli sur le cache uniquement hors-ligne.
  const isShell = req.mode === "navigate" || /\.(css|js|mjs|json|webmanifest)$/.test(url.pathname);
  if (isShell) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  // Autres (images, polices) : cache d'abord, mise à jour en arrière-plan.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
