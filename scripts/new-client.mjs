/* Autologix — Scaffold d'un nouveau client radio.
 *
 * Crée brand/<slug>.json (depuis un gabarit à compléter) + brand/<slug>/assets/,
 * puis affiche la checklist d'onboarding. Ne touche à rien d'autre.
 *
 * Usage :
 *   node scripts/new-client.mjs <slug> "Nom de la radio"
 *   ex : node scripts/new-client.mjs radiosoleil "Radio Soleil"
 */

import { writeFile, mkdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const slug = (process.argv[2] || "").trim().toLowerCase();
const name = (process.argv.slice(3).join(" ") || "").trim();

if (!/^[a-z0-9-]{2,40}$/.test(slug) || !name) {
  console.error('Usage : node scripts/new-client.mjs <slug> "Nom de la radio"');
  console.error("  slug : minuscules, chiffres, tirets (2-40 car.)");
  process.exit(1);
}

const jsonPath = join(root, "brand", `${slug}.json`);
try {
  await access(jsonPath);
  console.error(`✗ brand/${slug}.json existe déjà — choisis un autre slug.`);
  process.exit(1);
} catch {
  /* n'existe pas → on continue */
}

// Gabarit : valeurs « À REMPLIR » bien visibles (l'opérateur les complète).
const TODO = "À_REMPLIR";
const config = {
  slug,
  name,
  shortName: name,
  description: `${name} — radio en ligne.`,
  domain: `${slug}.example`,
  colors: {
    accent: "#c8102e",
    accentBright: "#e8192e",
    accentGlowRgb: "220, 20, 48",
    amber: "#e8192e",
    amberSoft: "#ff3349",
    themeColor: "#0f0f12",
    bgColor: "#0a0a0a",
  },
  stream: {
    url: `https://CHANGEME/stream`,
    panel: `https://CHANGEME/panel/`,
    host: "CHANGEME",
    nowPlayingProxy: `https://CHANGEME/7.html`,
  },
  urls: {
    api: `https://CHANGEME-api.up.railway.app`,
    presenceWss: `wss://CHANGEME-presence.up.railway.app/ws/presence`,
  },
  contact: { phone: TODO, email: "" },
};

await mkdir(join(root, "brand", slug, "assets"), { recursive: true });
await writeFile(join(root, "brand", slug, "assets", ".gitkeep"), "");
await writeFile(jsonPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

console.log(`✓ Client "${name}" créé.

  brand/${slug}.json          ← complète les champs CHANGEME / À_REMPLIR
  brand/${slug}/assets/       ← dépose logo, favicon, icônes PWA, fond

Étapes d'onboarding (voir ONBOARDING-CLIENT.md) :
  1. Remplir brand/${slug}.json (flux, domaine, URLs, couleurs, contact)
  2. Déposer les visuels dans brand/${slug}/assets/
  3. ⚖️  ATTESTATION LICENCES : confirmer que ${name} détient SOCAN + Ré:Sonne
  4. Sur un checkout propre :  BRAND=${slug} node scripts/build-all.mjs
  5. Déployer (nouveau projet Railway + Postgres ; SEED_BRAND=${slug} ; ALLOWED_ORIGINS)
  6. Vérifier :  node scripts/verify-deploy.mjs https://<api-du-client>
`);
