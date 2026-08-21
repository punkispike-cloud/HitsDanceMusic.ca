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

// Amène une page dans un état stable et comparable. Facteur commun des captures
// « état par défaut » et « états pilotés par JS » ci-dessous.
async function openPage(page, name) {
  // Consentement audience désactivé en test → pas de bannière (#consentBar) et
  // aucune collecte (analytics/presence gating). Garde les captures focalisées
  // sur le rendu, indépendantes du choix de consentement.
  // `audience-ack` : la mention Loi 25 (js/audience-banner.js) est un bandeau
  // haut de page qui décale TOUT le contenu en dessous. Elle n'apparaît que sur
  // un profil neuf — donc stable ici, mais on l'acquitte pour la même raison
  // qu'on coupe le consentement : la capture doit mesurer la cascade, pas un
  // état de stockage navigateur.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("hr.consent", "no");
      localStorage.setItem("audience-ack", "1");
    } catch { /* noop */ }
  });
  // Temps gelé : la grille/les rails « à venir » et le jour en surbrillance
  // dépendent de la date → sans gel, index/horaire/animateurs dérivent dès
  // que le calendrier avance. Instant fixe = captures reproductibles à jamais.
  await page.clock.install({ time: new Date("2026-07-14T18:00:00Z") });
  await blockExternal(page);
  await page.goto(`/${name}.html`, { waitUntil: "load" });
  // Attend l'injection JS du bouton play dans l'en-tête (sinon la nav peut
  // se redisposer entre deux captures selon le timing d'injection).
  await page.waitForSelector("#headerPlay", { timeout: 3000 }).catch(() => {});
  // La bottom-nav mobile (injectée en JS) ajoute `has-bottom-nav` → padding bas :
  // on l'attend pour figer la hauteur (timeout court, ignoré sur desktop).
  await page.waitForSelector("#bottomNav", { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(400);
}

for (const name of PAGES) {
  test(`page ${name}`, async ({ page }) => {
    await openPage(page, name);
    await settle(page);
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      mask: masks(page),
      timeout: 15_000,
    });
  });
}

/* État « lecture en cours » — priorité n°1 du filet (PLAN-PHASE5-DEGEL-CSS.md §4).
   Le flux audio est coupé par blockExternal, donc on ne peut pas VRAIMENT lire.
   Mais tout le rendu de cet état est piloté par la classe `is-playing` posée par
   js/player-ui.js sur `#player` et sur les boutons play : on la pose directement.
   C'est le contrat CSS↔JS documenté dans le plan — le tester ainsi mesure très
   exactement ce que la cascade fait de cet état.

   Ce que ça couvre et que l'état par défaut ne voit PAS : glow de la pochette,
   equalizer, rotation vinyle, badge live, et les DEUX arbres du même composant
   (`.player-panel--signature` et `.player-2026` cohabitent sur `#player`, cf.
   §2 du plan « composants redéfinis N× »). C'est la zone la plus exposée aux
   étapes 4 (consolidation des couleurs) et 5 (dé-importantage). */
/* Thème clair — capturé alors qu'il n'est PAS activable par l'auditeur.
   `assets/theme-init.js` fige data-theme="dark" avant le rendu et js/theme.js le
   réapplique : le CSS de styles/15- et 27- ne s'exécute donc jamais en vrai.
   C'était du code mort non testé — un piège pour qui voudrait le dégeler.

   On force l'attribut APRÈS le boot, ce qui suffit puisque toutes les règles
   sont scopées `:root[data-theme="light"]`. Le thème est ainsi prouvé rendu
   correctement, et son dégel devient une décision produit à une ligne plutôt
   qu'un saut dans le vide. */
for (const name of ["index", "contact"]) {
  test(`page ${name} — thème clair (dormant mais vérifié)`, async ({ page }) => {
    await openPage(page, name);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
      document.documentElement.dataset.themeMode = "light";
    });
    await page.waitForTimeout(200);
    await settle(page);
    await expect(page).toHaveScreenshot(`${name}-light.png`, {
      fullPage: true,
      mask: masks(page),
      timeout: 15_000,
    });
  });
}

test("index — player en lecture (is-playing)", async ({ page }) => {
  await openPage(page, "index");
  // Le contrat exact, relevé sur les sélecteurs `.X.is-playing` de styles/ et sur
  // les `classList` de js/player-ui.js + js/player.js. `#player` porte à la fois
  // `.player-panel` et `.player-2026` → une seule pose couvre les deux arbres.
  // `body.is-playing-radio` compte aussi : des règles `html:has(...)` en dépendent.
  await page.evaluate(() => {
    document.getElementById("player")?.classList.add("is-playing");
    document.body.classList.add("is-playing-radio");
    document.querySelectorAll(".play-button, .header-play, .watch-mode").forEach((b) => b.classList.add("is-playing"));
  });
  await page.waitForTimeout(200);
  await settle(page);
  await expect(page).toHaveScreenshot("index-playing.png", {
    fullPage: true,
    mask: masks(page),
    timeout: 15_000,
  });
});
