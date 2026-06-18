/* Hits Dance Music — Service Worker
   Cache-first pour le shell statique. NE jamais cacher le flux audio. */
const CACHE = "hitradio-3b806dc91e4d";
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
  "./styles/00-base.css",
  "./styles/01-components-lounge.css",
  "./styles/02-hero.css",
  "./styles/03-player.css",
  "./styles/04-mini-player.css",
  "./styles/05-schedule.css",
  "./styles/06-toasts.css",
  "./styles/07-history-drawer.css",
  "./styles/08-contact.css",
  "./styles/09-emissions.css",
  "./styles/10-header-tools.css",
  "./styles/11-install-band.css",
  "./styles/12-sleep.css",
  "./styles/13-search-palette.css",
  "./styles/14-countdown.css",
  "./styles/15-offline-and-theme-fragment.css",
  "./styles/16-favorites.css",
  "./styles/17-stats.css",
  "./styles/18-misc-extras.css",
  "./styles/19-phase1-polish.css",
  "./styles/20-phase2-ux.css",
  "./styles/21-phase4-mobile.css",
  "./styles/22-featured-partners.css",
  "./styles/23-requests-nav-a11y.css",
  "./styles/24-ui-extras.css",
  "./styles/25-mobile-perfection.css",
  "./styles/26-mobile-header-fix.css",
  "./styles/27-theme-light.css",
  "./styles/28-player-2026.css",
  "./manifest.webmanifest",
  "./assets/favicon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/logo-final.webp",
  "./assets/landing-bg.webp",
  "./assets/theme-init.js",
  "./js/main.js",
  "./js/api-config.js",
  "./js/analytics.js",
  "./js/content.js",
  "./js/util.js",
  "./js/store.js",
  "./js/time.js",
  "./js/state.js",
  "./js/toast.js",
  "./js/a11y.js",
  "./js/theme.js",
  "./js/schedule.js",
  "./js/now-playing.js",
  "./js/share.js",
  "./js/player.js",
  "./js/player-ui.js",
  "./js/multi-tab.js",
  "./js/nav.js",
  "./js/install-pwa.js",
  "./js/sleep.js",
  "./js/keyboard.js",
  "./js/history-drawer.js",
  "./js/search-palette.js",
  "./js/shortcuts-help.js",
  "./js/now-drawer.js",
  "./js/watch.js",
  "./js/lyrics.js",
  "./js/pip.js",
  "./js/dynamic-accent.js",
  "./js/emoji-float.js",
  "./js/rails.js",
  "./js/weather.js",
  "./js/bottom-nav.js",
  "./js/notifications.js",
  "./js/favorites.js",
  "./js/stats.js",
  "./js/contact-form.js",
  "./js/connectivity.js",
  "./js/seo.js",
  "./js/countdown.js",
  "./js/animateurs.js",
  "./js/deep-links.js",
  "./js/ui-extras.js",
  "./js/presence.js",
  "./js/sw-register.js",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const oldKeys = keys.filter((k) => k !== CACHE);
    await Promise.all(oldKeys.map((k) => caches.delete(k)));
    await self.clients.claim();
    // Si une ancienne version existait, notifier les clients pour qu'ils
    // affichent un toast "Nouvelle version — recharger".
    if (oldKeys.length > 0 && "BroadcastChannel" in self) {
      try {
        const ch = new BroadcastChannel("hitradio-sw");
        ch.postMessage({ type: "updated", cache: CACHE });
        ch.close();
      } catch { /* noop */ }
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Ne jamais cacher : flux audio, métadonnées now-playing (/np proxifié +
  // asurahosting direct), iTunes, fonts dynamiques
  if (
    url.pathname === "/np" ||
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
