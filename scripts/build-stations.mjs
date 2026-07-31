/* En Ondes — Build Stations (annuaire public du hub d'écoute)
 *
 * Compile le registre privé (brand/clients.json) + la config par marque
 * (brand/<slug>.json) en DEUX sorties :
 *   1. enondes-site/stations.json  — manifeste PUBLIC lu par hub.js.
 *   2. enondes-site/nginx.conf     — blocs « location = /np/<slug> » (proxy
 *      now-playing par station) régénérés entre les marqueurs NP-PROXY.
 *
 * Règles :
 *   - Opt-in : une station n'est incluse que si clients.json a
 *     listing.directory === true (ton réseau + clients qui acceptent).
 *   - Sécurité : on n'exporte QUE des champs publics (nom, genre, couleurs,
 *     flux, site). JAMAIS billing / railwayProject / URLs admin de clients.json.
 *   - Statut : "live" si le client est actif ET que le flux est réel
 *     (pas vide, pas "CHANGEME") ; sinon "coming".
 *   - now-playing : exposé en /np/<slug> (same-origin, proxifié par nginx) si la
 *     station a un nowPlayingProxy réel ; sinon null (le hub dégrade proprement).
 *
 * Registre privé : brand/clients.json est GITIGNORED (donc absent d'un checkout
 * CI frais). Quand il manque :
 *   - mode --check  → vérification d'INTÉGRITÉ des artefacts commités
 *     (enondes-site/stations.json + nginx.conf), exit 1 si malformé, 0 sinon.
 *   - mode normal   → avertissement + rien écrit (exit 0), jamais de crash.
 * Quand il est présent : sync exacte (régénération manifeste + nginx).
 *
 * Usage :
 *   node scripts/build-stations.mjs            # (ré)génère manifeste + nginx
 *   node scripts/build-stations.mjs --check    # exit 1 si hors sync (CI) ou artefact malformé
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const checkMode = process.argv.includes("--check");
const OUT_JSON = join(root, "enondes-site", "stations.json");
const OUT_NGINX = join(root, "enondes-site", "nginx.conf");
const NP_BEGIN = "    # === NP-PROXY:BEGIN";
const NP_END = "    # === NP-PROXY:END ===";

// Placeholders : "CHANGEME", "(à créer)", et le TLD réservé ".example" (ancré
// par \b pour ne PAS matcher un vrai hôte du genre "stream.examplemusic.fm").
const PLACEHOLDER = /changeme|à créer|\.example\b/i;
const isReal = (url) => typeof url === "string" && url.length > 0 && !PLACEHOLDER.test(url);

async function readJson(rel) {
  return JSON.parse(await readFile(join(root, rel), "utf-8"));
}

/* ---------- Registre privé (gitignored — absent d'un checkout CI frais) ---------- */
const registryText = await readFile(join(root, "brand/clients.json"), "utf-8").catch(() => null);

if (registryText === null) {
  /* brand/clients.json absent : pas de (re)génération possible. En --check, on
     valide l'intégrité des artefacts COMMITÉS (stations.json + nginx.conf) ;
     sinon on avertit et on n'écrit rien. Jamais de crash. */
  if (!checkMode) {
    console.warn("[build-stations] ⚠ registre privé brand/clients.json absent — rien à régénérer (exit 0).");
    process.exit(0);
  }

  let bad = 0;

  // 1. stations.json : JSON valide + champs publics requis par station.
  let stationsCount = null;
  const jsonText = await readFile(OUT_JSON, "utf-8").catch(() => null);
  if (jsonText === null) {
    console.error("[build-stations] ✗ enondes-site/stations.json introuvable.");
    bad++;
  } else {
    let manifest;
    try {
      manifest = JSON.parse(jsonText);
    } catch (err) {
      console.error(`[build-stations] ✗ stations.json : JSON invalide — ${err.message}`);
      bad++;
      manifest = null;
    }
    if (manifest) {
      if (typeof manifest.network !== "string") {
        console.error("[build-stations] ✗ stations.json : champ `network` manquant (string attendu).");
        bad++;
      }
      const stations = manifest.stations;
      if (!Array.isArray(stations)) {
        console.error("[build-stations] ✗ stations.json : champ `stations` manquant (tableau attendu).");
        bad++;
      } else {
        stationsCount = stations.length;
        for (const s of stations) {
          const ok =
            typeof s.slug === "string" && s.slug.length > 0 &&
            typeof s.name === "string" && s.name.length > 0 &&
            (s.status === "live" || s.status === "coming") &&
            (s.stream === null || typeof s.stream === "string");
          if (!ok) {
            console.error(`[build-stations] ✗ station malformée : ${JSON.stringify(s)}`);
            bad++;
          }
        }
      }
    }
  }

  // 2. nginx.conf : marqueurs NP-PROXY présents et dans le bon ordre.
  const nginxText = await readFile(OUT_NGINX, "utf-8").catch(() => null);
  if (nginxText === null) {
    console.error("[build-stations] ✗ enondes-site/nginx.conf introuvable.");
    bad++;
  } else {
    const i = nginxText.indexOf(NP_BEGIN);
    const j = nginxText.indexOf(NP_END);
    if (i === -1 || j === -1) {
      console.error("[build-stations] ✗ nginx.conf : marqueurs NP-PROXY absents.");
      bad++;
    } else if (j < i) {
      console.error("[build-stations] ✗ nginx.conf : marqueurs NP-PROXY dans le mauvais ordre (END avant BEGIN).");
      bad++;
    }
  }

  if (bad > 0) {
    console.error(`[build-stations] ${bad} problème(s) d'intégrité sur les artefacts commités.`);
    process.exit(1);
  }
  console.log(`[build-stations] registre privé absent — vérification d'intégrité des artefacts commités OK (${stationsCount} station·s).`);
  process.exit(0);
}

/* ---------- Registre présent : sync manifeste + nginx (inchangé) ---------- */
const registry = JSON.parse(registryText);
const listed = (registry.clients ?? [])
  .filter((c) => c?.listing?.directory === true)
  .sort((a, b) => (a.listing.order ?? 99) - (b.listing.order ?? 99));

const stations = [];
const npProxies = []; // { slug, upstream, host } pour les blocs nginx

for (const c of listed) {
  let brand;
  try {
    brand = await readJson(`brand/${c.slug}.json`);
  } catch {
    console.warn(`[build-stations] ⚠ brand/${c.slug}.json introuvable — station ignorée`);
    continue;
  }

  const live = c.status === "active" && isReal(brand.stream?.url);
  const hasNp = live && isReal(brand.stream?.nowPlayingProxy) && isReal(brand.stream?.host);
  // Site public : jamais un domaine placeholder (sinon lien mort dans le manifeste).
  const site = c.domains?.site || (isReal(brand.domain) ? `https://${brand.domain}` : null);
  if (hasNp) npProxies.push({ slug: brand.slug, upstream: brand.stream.nowPlayingProxy, host: brand.stream.host });
  // Garde-fou : station live avec now-playing mais sans host → bloc /np impossible.
  if (live && isReal(brand.stream?.nowPlayingProxy) && !isReal(brand.stream?.host)) {
    console.warn(`[build-stations] ⚠ ${brand.slug} : nowPlayingProxy présent mais stream.host manquant — proxy /np non généré.`);
  }

  stations.push({
    slug: brand.slug,
    name: brand.name,
    shortName: brand.shortName || brand.name,
    genre: brand.genre || "",
    description: brand.description || "",
    status: live ? "live" : "coming",
    owned: c.listing.owned === true,
    site: site || null,
    region: typeof brand.region === "string" ? brand.region : "",
    lang: typeof brand.lang === "string" ? brand.lang : "",
    colors: {
      accent: brand.colors?.accent || "#3aa0ff",
      accentBright: brand.colors?.accentBright || brand.colors?.accent || "#5fb8ff",
      bg: brand.colors?.bgColor || "#0a0e16",
      glowRgb: brand.colors?.accentGlowRgb || "58, 160, 255",
    },
    // Flux audio : joue directement dans <audio> (pas de contrainte CORS).
    stream: live ? brand.stream.url : null,
    // Now-playing same-origin proxifié par nginx (cf. /np/<slug> généré ci-dessous).
    nowPlaying: hasNp ? `/np/${brand.slug}` : null,
  });
}

/* ---------- Partenaires opt-in (radios tierces non hébergées) ---------- */
// brand/partners.json est PUBLIC/commité (donc lisible partout). L'INTÉGRATION des
// partenaires n'a lieu que dans cette branche (registre présent) ; en checkout CI
// sans clients.json, on ne (re)génère pas — on régénère localement puis on commit
// stations.json (qui embarque déjà les partenaires).
const partnersDoc = await readFile(join(root, "brand/partners.json"), "utf-8")
  .then(JSON.parse)
  .catch(() => null);
const takenSlugs = new Set(stations.map((s) => s.slug)); // slugs déjà pris par les clients
const asStr = (v) => (typeof v === "string" ? v : ""); // ignore les valeurs non-string (region/lang)
for (const p of partnersDoc?.partners ?? []) {
  if (p?.listed !== true) continue; // fiche non publiée
  if (p?.licenseAttested !== true) {
    console.warn(`[build-stations] ⚠ partenaire ${p?.slug ?? "?"} sans licenseAttested — ignoré`);
    continue;
  }
  if (!p.slug || !p.name || !isReal(p.stream)) {
    console.warn(`[build-stations] ⚠ partenaire ${p?.slug ?? "?"} incomplet (slug/name/stream) — ignoré`);
    continue;
  }
  if (takenSlugs.has(p.slug)) {
    console.warn(`[build-stations] ⚠ partenaire ${p.slug} : slug déjà utilisé (client ou autre partenaire) — ignoré`);
    continue;
  }
  takenSlugs.add(p.slug);
  stations.push({
    slug: p.slug,
    name: p.name,
    shortName: p.shortName || p.name,
    genre: p.genre || "",
    description: p.description || "",
    status: "live",
    owned: false, // partenaire tiers, jamais du réseau En Ondes
    site: isReal(p.site) ? p.site : null,
    region: asStr(p.region),
    lang: asStr(p.lang),
    colors: {
      accent: p.colors?.accent || "#3aa0ff",
      accentBright: p.colors?.accentBright || p.colors?.accent || "#5fb8ff",
      bg: p.colors?.bg || "#0a0e16",
      glowRgb: p.colors?.glowRgb || "58, 160, 255",
    },
    stream: p.stream,
    nowPlaying: null, // pas de proxy /np pour un flux tiers (le hub dégrade proprement)
  });
}

/* ---------- 1. Manifeste public ---------- */
const manifest = {
  _generated: "scripts/build-stations.mjs — NE PAS ÉDITER À LA MAIN",
  network: "En Ondes",
  stations,
};
const nextJson = JSON.stringify(manifest, null, 2) + "\n";

/* ---------- 2. Blocs nginx /np/<slug> ---------- */
function npBlock({ slug, upstream, host }) {
  return `    location = /np/${slug} {
        proxy_pass ${upstream};
        proxy_set_header Host ${host};
        proxy_set_header User-Agent "EnOndes-Hub-Proxy/1.0";
        proxy_ssl_server_name on;
        proxy_connect_timeout 3s; proxy_read_timeout 5s; proxy_send_timeout 3s;
        proxy_cache np_cache;
        proxy_cache_key "np_${slug}";
        proxy_ignore_headers Set-Cookie Cache-Control Expires;
        proxy_hide_header Set-Cookie;
        proxy_cache_valid 200 5s;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        add_header Access-Control-Allow-Origin "$scheme://$host" always;
        add_header Cache-Control "no-store" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Cache-Status $upstream_cache_status always;
    }`;
}

function regenNginx(current) {
  const i = current.indexOf(NP_BEGIN);
  const j = current.indexOf(NP_END);
  if (i === -1 || j === -1 || j < i) {
    console.warn("[build-stations] ⚠ marqueurs NP-PROXY absents de enondes-site/nginx.conf — bloc /np non régénéré");
    return null;
  }
  const head = current.slice(0, i);
  const tail = current.slice(j + NP_END.length);
  const blocks = npProxies.length
    ? npProxies.map(npBlock).join("\n\n")
    : "    # (aucune station live avec now-playing pour l'instant)";
  const body =
    `${NP_BEGIN} (généré par scripts/build-stations.mjs — ne pas éditer) ===\n` +
    `${blocks}\n` +
    NP_END;
  return head + body + tail;
}

/* ---------- Écriture / vérification ---------- */
let drift = 0;

const beforeJson = await readFile(OUT_JSON, "utf-8").catch(() => null);
if (beforeJson !== nextJson) {
  drift++;
  if (!checkMode) await writeFile(OUT_JSON, nextJson, "utf-8");
  console.log(`[build-stations] ${checkMode ? "✗" : "✓"} stations.json (${stations.length} station·s : ${stations.map((s) => `${s.slug}/${s.status}`).join(", ")})`);
}

const beforeNginx = await readFile(OUT_NGINX, "utf-8").catch(() => null);
if (beforeNginx != null) {
  const nextNginx = regenNginx(beforeNginx);
  if (nextNginx != null && nextNginx !== beforeNginx) {
    drift++;
    if (!checkMode) await writeFile(OUT_NGINX, nextNginx, "utf-8");
    console.log(`[build-stations] ${checkMode ? "✗" : "✓"} nginx.conf (/np : ${npProxies.map((p) => p.slug).join(", ") || "aucun"})`);
  }
}

if (drift === 0) console.log(`[build-stations] ✓ à jour (${stations.length} station·s)`);
if (checkMode && drift > 0) {
  console.error(`[build-stations] ${drift} sortie(s) hors sync — relance sans --check`);
  process.exit(1);
}
