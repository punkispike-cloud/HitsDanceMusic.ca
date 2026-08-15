import { defineConfig } from "@playwright/test";

/* Smoke CI — pas de comparaison pixel (les baselines sont win32).
   Sert le site local + vérifie que la page charge et que l'API répond. */

const PORT = 8099;

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  retries: 1,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  },
  webServer: {
    command: `node tests/visual/serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    cwd: "../..",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } }],
});
