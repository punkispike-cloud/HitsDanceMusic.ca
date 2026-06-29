import { defineConfig } from "@playwright/test";

/* Filet anti-régression visuelle — Phase 5 (dégel CSS Hits Dance).
   Sert le site statique localement et compare des captures pixel à pixel.
   Déterminisme : mouvement réduit (coupe le polish WAAPI + CSS), animations
   gelées, service workers bloqués, réseau externe coupé (sauf polices),
   zones dynamiques (horloge, titre live) masquées. */

const PORT = 8099;

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  },
  expect: {
    // Tolérance minime pour absorber le bruit d'anticrénelage sans masquer une
    // vraie régression (un changement de couleur/layout touche bien plus de px).
    toHaveScreenshot: { animations: "disabled", maxDiffPixelRatio: 0.01 },
  },
  webServer: {
    command: `node tests/visual/serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    cwd: "../..",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
});
