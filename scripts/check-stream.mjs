#!/usr/bin/env node
/* Santé du flux : mesure ce que le serveur livre RÉELLEMENT, en décodant les
 * en-têtes de trames MP3 plutôt qu'en comptant les octets. C'est la seule
 * mesure qui tranche entre les deux causes de « ça se met en tampon » :
 *
 *   ratio ≈ 1,0 et plus  → le serveur tient le temps réel, le problème est ailleurs
 *                          (réseau de l'auditeur, ou logique de reconnexion du player)
 *   ratio < 1,0          → le serveur livre moins d'audio que de temps qui passe :
 *                          le tampon du navigateur se vide, la coupure est
 *                          arithmétiquement inévitable, aucun correctif client
 *                          ne peut la rattraper.
 *
 * Le TTFB compte aussi : c'est le silence subi à chaque reconnexion.
 * Un serveur sain envoie en plus une rafale à la connexion (burst-on-connect),
 * ce qui donne un ratio nettement > 1 sur les premières secondes — c'est cette
 * avance qui absorbe les hoquets réseau des auditeurs.
 *
 * Usage :
 *   node scripts/check-stream.mjs                       # flux de la marque courante
 *   node scripts/check-stream.mjs <url> [secondes] [n]  # n connexions successives
 */
import https from "node:https";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function defaultStreamUrl() {
  // On lit brand.generated.js sans l'importer : le script doit rester utilisable
  // même si la marque courante n'est pas celle du build en cours.
  try {
    const src = readFileSync(join(ROOT, "js", "brand.generated.js"), "utf8");
    return src.match(/stream:\s*\{\s*url:\s*"([^"]+)"/)?.[1] ?? null;
  } catch {
    return null;
  }
}

const url = process.argv[2] || defaultStreamUrl();
const seconds = Number(process.argv[3] || 45);
// 5 connexions par défaut : la livraison varie beaucoup d'une socket à l'autre
// (ratios de 0,63 à 1,13 observés sur le même serveur en une heure). Une seule
// mesure conclut à pile ou face.
const runs = Number(process.argv[4] || 5);

if (!url) {
  console.error("Aucune URL de flux (argument manquant et js/brand.generated.js illisible).");
  process.exit(1);
}

const BITRATES_V1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SR_V1 = [44100, 48000, 32000, 0];
const SR_V2 = [22050, 24000, 16000, 0];

/* Parcourt les trames MP3 et renvoie la durée audio totale. Un simple comptage
 * d'octets ne suffirait pas : il confondrait « flux encodé plus bas que annoncé »
 * (bénin) et « serveur en retard sur le temps réel » (fatal). */
function audioSeconds(buf) {
  let i = 0;
  let total = 0;
  let frames = 0;
  const rates = new Map();
  while (i < buf.length - 4) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      const ver = (buf[i + 1] >> 3) & 0x03;   // 3 = MPEG1, 2 = MPEG2
      const layer = (buf[i + 1] >> 1) & 0x03; // 1 = Layer III
      const brIdx = (buf[i + 2] >> 4) & 0x0f;
      const srIdx = (buf[i + 2] >> 2) & 0x03;
      const pad = (buf[i + 2] >> 1) & 0x01;
      if (layer === 1 && brIdx > 0 && brIdx < 15 && srIdx < 3 && (ver === 3 || ver === 2)) {
        const br = (ver === 3 ? BITRATES_V1L3 : BITRATES_V2L3)[brIdx] * 1000;
        const sr = (ver === 3 ? SR_V1 : SR_V2)[srIdx];
        const spf = ver === 3 ? 1152 : 576;
        const len = Math.floor(((spf / 8) * br) / sr) + pad;
        if (len > 4) {
          frames++;
          total += spf / sr;
          rates.set(br / 1000, (rates.get(br / 1000) || 0) + 1);
          i += len;
          continue;
        }
      }
    }
    i++;
  }
  return { seconds: total, frames, rates };
}

function probe(target, durationSec) {
  return new Promise((resolve) => {
    const client = target.startsWith("http://") ? http : https;
    const chunks = [];
    const t0 = Date.now();
    let firstByteAt = 0;
    let lastChunkAt = t0;
    let maxGap = 0;
    let gaps = 0;
    let status = 0;
    let headers = {};

    const req = client.get(target, { headers: { "User-Agent": "check-stream/1.0" } }, (res) => {
      status = res.statusCode;
      headers = res.headers;
      res.on("data", (c) => {
        const now = Date.now();
        if (!firstByteAt) { firstByteAt = now; lastChunkAt = now; }
        const gap = now - lastChunkAt;
        if (gap > maxGap) maxGap = gap;
        if (gap > 1000) gaps++;
        lastChunkAt = now;
        chunks.push(c);
      });
    });
    req.on("error", (e) => resolve({ error: e.message }));

    setTimeout(() => {
      req.destroy();
      const buf = Buffer.concat(chunks);
      const wall = firstByteAt ? (Date.now() - firstByteAt) / 1000 : 0;
      const { seconds: audio, frames, rates } = audioSeconds(buf);
      resolve({
        status, headers, bytes: buf.length, wall, audio, frames, rates,
        ttfb: firstByteAt ? firstByteAt - t0 : null,
        maxGap, gaps,
        ratio: wall > 0 ? audio / wall : 0,
      });
    }, durationSec * 1000);
  });
}

console.log(`Flux   : ${url}`);
console.log(`Mesure : ${runs} connexion(s) de ${seconds} s\n`);

const ratios = [];
const ttfbs = [];

for (let n = 1; n <= runs; n++) {
  const r = await probe(url, seconds);
  if (r.error) { console.log(`#${n}  ÉCHEC : ${r.error}`); continue; }
  if (!r.frames) { console.log(`#${n}  HTTP ${r.status} — aucune trame MP3 lisible (flux AAC/OGG ? ${r.headers["content-type"]})`); continue; }
  ratios.push(r.ratio);
  if (r.ttfb != null) ttfbs.push(r.ttfb);
  const declared = r.headers["icy-br"] ? `${r.headers["icy-br"]} kbps annoncés` : "débit non annoncé";
  const encoded = [...r.rates.entries()].sort((a, b) => b[1] - a[1])[0][0];
  console.log(
    `#${n}  HTTP ${r.status} | ${declared}, ${encoded} kbps encodés | TTFB ${r.ttfb} ms\n` +
    `    audio livré ${r.audio.toFixed(1)}s pour ${r.wall.toFixed(1)}s d'horloge → ratio ${r.ratio.toFixed(2)}\n` +
    `    trous de livraison > 1 s : ${r.gaps} (plus long ${r.maxGap} ms)`
  );
}

if (!ratios.length) { console.log("\nAucune mesure exploitable."); process.exit(1); }

const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
const avgTtfb = ttfbs.length ? Math.round(ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length) : null;
const deficit = Math.round((1 - avg) * 60);

const lo = Math.min(...ratios);
const hi = Math.max(...ratios);

console.log(`\n── Verdict ──`);
console.log(
  `ratio moyen ${avg.toFixed(2)} (de ${lo.toFixed(2)} à ${hi.toFixed(2)} sur ${ratios.length} connexions)` +
  `${avgTtfb != null ? ` | TTFB moyen ${avgTtfb} ms` : ""}`
);
if (hi - lo > 0.2) {
  console.log(`Écart important entre connexions : la qualité dépend de la socket obtenue,\nsigne d'un serveur surchargé plutôt que d'un réglage de débit.`);
}
if (avg < 0.97) {
  console.log(
    `Le serveur livre ~${deficit} s d'audio en MOINS par minute écoutée.\n` +
    `Le tampon du navigateur se vide puis se recharge en boucle : c'est la mise\n` +
    `en tampon subie par les auditeurs, et elle ne se corrige pas côté client.\n` +
    `→ dossier à ouvrir chez l'hébergeur du flux (ou changer de serveur).`
  );
  process.exit(2);
}
console.log(`Le serveur tient le temps réel. Si des coupures persistent, chercher\ncôté réseau de l'auditeur ou logique de reconnexion du player.`);
