/* Hit Radio — Service Worker
   Cache-first pour le shell statique. NE jamais cacher le flux audio. */
const CACHE = "hitradio-v48";
const SHELL = [
  "./",
  "./index.html",
  "./animateurs.html",
  "./emissions.html",
  "./horaire.html",
  "./contact.html",
  "./404.html",
  "./stats.html",
  "./styles.css",
  "./script.js",
  "./manifest.webmanifest",
  "./assets/favicon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/logo-final.jpg",
  "./assets/landing-bg.jpg",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Ne jamais cacher : flux audio, métadonnées Centova, iTunes, fonts dynamiques
  if (
    url.hostname.includes("asurahosting.com") ||
    url.hostname.includes("itunes.apple.com") ||
    url.hostname.includes("fonts.gstatic.com") ||
    req.headers.get("range")
  ) return;

  // Same-origin : stale-while-revalidate avec fallback offline
  if (url.origin === location.origin) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req).then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(async () => {
          if (cached) return cached;
          if (req.mode === "navigate") {
            return (await cache.match("./index.html")) || (await cache.match("./404.html"));
          }
          return Response.error();
        });
        return cached || network;
      })
    );
  }
});
