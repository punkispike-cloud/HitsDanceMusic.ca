import { test, expect } from "@playwright/test";

/* Captures de référence des 9 pages publiques (chacune charge styles.css).
   Sert de filet AVANT le dégel CSS : toute étape de migration relance
   `npm run snap:check` et le diff doit rester vide (ou être intentionnel). */

const PAGES = [
  "index",
  "emissions",
  "horaire",
  "animateurs",
  "podcasts",
  "stats",
  "contact",
  "confidentialite",
  "404",
];

// Réseau : on autorise local + Google Fonts, on coupe le reste (iTunes, /np,
// API, flux audio) → rendu déterministe sur les états de repli.
async function blockExternal(page) {
  await page.route("**/*", (route) => {
    let host = "";
    try { host = new URL(route.request().url()).hostname; } catch { /* noop */ }
    const allowed =
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "fonts.googleapis.com" ||
      host === "fonts.gstatic.com";
    return allowed ? route.continue() : route.abort();
  });
}

// Zones dynamiques masquées (horloge, titre live, pochettes) pour la stabilité.
function masks(page) {
  return [
    page.locator("#clock"),
    page.locator("#playerClock"),
    page.locator("#liveTrackText"),
    page.locator("#liveTrackLine"),
    page.locator("#miniTrack"),
    page.locator("#onAirCover"),
    page.locator("#nextShowCountdown"), // compte à rebours (tique chaque seconde)
  ];
}

// Stabilise la page : gèle toute animation, déclenche le chargement des images
// lazy (sinon une image qui se charge pendant la capture fullPage décale le
// layout → jamais stable), attend leur complétion, puis revient en haut.
async function settle(page) {
  await page.addStyleTag({
    content: [
      // Gèle toute animation/transition.
      "*,*::before,*::after{animation:none!important;transition:none!important;animation-duration:0s!important;scroll-behavior:auto!important;caret-color:transparent!important}",
      // Neutralise le flou (backdrop-filter produit du bruit sous-pixel non déterministe).
      "*,*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}",
      // Masque le mini-lecteur (fixe, affiché/masqué selon le scroll via IntersectionObserver → instable).
      "#miniPlayer{display:none!important}",
      // Supprime le grain/scanlines décoratifs (filtre SVG feTurbulence → bruit aléatoire à chaque rendu).
      "body::before,body::after{display:none!important;content:none!important}",
    ].join("\n"),
  });
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const h = document.body.scrollHeight;
      const step = () => {
        window.scrollTo(0, y);
        y += Math.round(window.innerHeight * 0.8);
        if (y < h) setTimeout(step, 40);
        else { window.scrollTo(0, 0); setTimeout(resolve, 150); }
      };
      step();
    });
    await Promise.all(
      Array.from(document.images)
        .filter((img) => !img.complete)
        .map((img) => new Promise((res) => { img.onload = img.onerror = res; })),
    );
    // Attend que la hauteur du document soit stable (contenu rendu en JS terminé)
    // — sinon une capture peut tomber avant le rendu (page courte) et l'autre
    // après (page haute), créant une fausse régression.
    await new Promise((resolve) => {
      let last = -1, stable = 0, ticks = 0;
      const tick = () => {
        const h = document.body.scrollHeight;
        if (h === last) { if (++stable >= 5) return resolve(); }
        else { stable = 0; last = h; }
        if (++ticks > 80) return resolve(); // garde-fou ~8 s
        setTimeout(tick, 100);
      };
      tick();
    });
  });
}

for (const name of PAGES) {
  test(`page ${name}`, async ({ page }) => {
    // Consentement audience désactivé en test → pas de bannière (#consentBar) et
    // aucune collecte (analytics/presence gating). Garde les captures focalisées
    // sur le rendu, indépendantes du choix de consentement.
    await page.addInitScript(() => { try { localStorage.setItem("hr.consent", "no"); } catch { /* noop */ } });
    await blockExternal(page);
    await page.goto(`/${name}.html`, { waitUntil: "load" });
    // Attend l'injection JS du bouton play dans l'en-tête (sinon la nav peut
    // se redisposer entre deux captures selon le timing d'injection).
    await page.waitForSelector("#headerPlay", { timeout: 3000 }).catch(() => {});
    // La bottom-nav mobile (injectée en JS) ajoute `has-bottom-nav` → padding bas :
    // on l'attend pour figer la hauteur (timeout court, ignoré sur desktop).
    await page.waitForSelector("#bottomNav", { timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(400);
    await settle(page);
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      mask: masks(page),
      timeout: 15_000,
    });
  });
}
