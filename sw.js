/* Hits Dance Music — Service Worker
   Cache-first pour le shell statique. NE jamais cacher le flux audio. */
const CACHE = "hitradio-5d278bf81cf8";
/* SHELL — liste des ressources précachées pour l'offline.
   ⚠ Maintenance manuelle : ce tableau est la source unique du précache.
   build-sw.mjs en rehash le contenu (→ bump auto de CACHE) et avertit si un
   fichier listé est manquant ou si un module js/ n'y figure pas (drift).
   CSS : depuis la Phase 5, le bundle UNIQUE styles.bundle.css (compilé par
   scripts/build-css.mjs depuis styles.css + styles/*.css) remplace l'ancienne
   chaîne de 33 @import — NE PAS remettre les partials styles/*.css ici. */
const SHELL = [
  "./",
  "./index.html",
  "./animateurs.html",
  "./emissions.html",
  "./podcasts.html",
  "./confidentialite.html",
  "./horaire.html",
  "./contact.html",
  "./404.html",
  "./stats.html",
  "./styles.bundle.css",
  "./manifest.webmanifest",
  "./assets/favicon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/logo-final.webp",
  "./assets/landing-bg.webp",
  "./assets/theme-init.js",
  "./js/main.js",
  "./js/brand.generated.js",
  "./js/api-config.js",
  "./js/analytics.js",
  "./js/content.js",
  "./js/podcasts-page.js",
  "./js/push-subscribe.js",
  "./js/live-badge.js",
  "./js/animateur-detail.js",
  "./js/util.js",
  "./js/store.js",
  "./js/time.js",
  "./js/state.js",
  "./js/toast.js",
  "./js/a11y.js",
  "./js/a11y-modal.js",
  "./js/consent.js",
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
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      // Précache fichier par fichier (tolérant) : un asset manquant n'invalide
      // plus TOUT le cache offline (addAll est atomique), et les échecs sont visibles.
      const results = await Promise.allSettled(SHELL.map((u) => c.add(u)));
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed) console.warn(`[SW] précache: ${failed}/${SHELL.length} fichier(s) en échec`);
    }),
  );
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

/* Web Push : affiche la notification de rappel d'émission. */
self.addEventListener("push", (event) => {
  let data = { title: "Hits Dance Music", body: "", url: "/" };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch { /* payload non-JSON */ }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag || "hitradio",
      icon: "./assets/icon-192.png",
      badge: "./assets/icon-192.png",
      data: { url: data.url || "/" },
    })
  );
});

/* Clic sur la notification : aller à l'URL cible (focus l'onglet déjà dessus,
   sinon navigue un onglet existant, sinon en ouvre un). */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const targetUrl = new URL(target, self.location.origin).href;
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // 1) Un onglet est déjà sur l'URL cible → on le focus.
    for (const c of all) {
      if (c.url === targetUrl && "focus" in c) {
        try { return await c.focus(); } catch { /* noop */ }
      }
    }
    // 2) Sinon, naviguer un onglet existant vers la cible puis le focus.
    for (const c of all) {
      if ("navigate" in c) {
        try { const nc = await c.navigate(targetUrl); return await (nc || c).focus(); } catch { /* noop */ }
      }
    }
    // 3) Aucun onglet → en ouvrir un.
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
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
