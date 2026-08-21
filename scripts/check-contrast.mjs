/* Vérifie les ratios de contraste WCAG 2.2 AA des tokens de design.
 * Usage : node scripts/check-contrast.mjs
 * Exit 1 si un couple texte/fond échoue le seuil AA (4.5:1 texte normal, 3:1 texte large).
 *
 * Depuis la Phase 5 étape 3b, les neutres (fonds, encre, atténué) sont
 * surchargeables par marque via brand/<slug>.json → palette.semantic.dark.
 * Ce script lisait auparavant des couleurs CODÉES EN DUR : il aurait validé les
 * valeurs de Hits Dance quelle que soit la marque réellement bâtie, et laissé
 * passer une marque inaccessible. Il parcourt donc maintenant TOUTES les marques
 * de brand/ — pas seulement la marque active — pour qu'un client au contraste
 * insuffisant fasse échouer la CI même si personne n'a bâti sa cible.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/* Valeurs de repli = celles déclarées dans styles/00-base.css (via les
 * primitives). Une marque sans palette.semantic.dark hérite d'elles.
 * ⚠ À resynchroniser si le bloc :root de 00-base.css change de valeurs. */
const BASELINE_DARK = {
  bg: "#0a0a0a",
  surface: "#1a1a1a",
  ink: "#f5f5f5",
  muted: "#9a9a9a",
};

/* Thème clair : encore dormant (js/theme.js fige data-theme="dark"), défini par
 * styles/15- et 27-, non paramétrable par marque. Vérifié tel quel jusqu'à
 * l'étape 6, qui le tokenisera et le dégèlera. */
const LIGHT_PAIRS = [
  { label: "light — muted sur bg", fg: "#525252", bg: "#fafafa", min: 4.5 },
  { label: "light — muted sur surface", fg: "#525252", bg: "#f3f3f3", min: 4.5 },
  { label: "light — ink sur bg", fg: "#141414", bg: "#fafafa", min: 4.5 },
  { label: "light — accent sur bg", fg: "#c8102e", bg: "#fafafa", min: 3 },
];

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function relLuminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg, bg) {
  const l1 = relLuminance(hexToRgb(fg));
  const l2 = relLuminance(hexToRgb(bg));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/* Couples à vérifier pour une marque donnée. On ne teste que des couleurs
 * OPAQUES : les tokens translucides (--line, --surface-glass, --gold-border)
 * ne portent pas de texte, leur ratio n'aurait pas de sens ici. */
function pairsForBrand(brand) {
  const d = { ...BASELINE_DARK, ...(brand.palette?.semantic?.dark ?? {}) };
  const accent = brand.colors.accent;
  const tag = `${brand.slug} — dark`;
  return [
    { label: `${tag} — muted sur bg`, fg: d.muted, bg: d.bg, min: 4.5 },
    { label: `${tag} — muted sur surface`, fg: d.muted, bg: d.surface, min: 4.5 },
    { label: `${tag} — ink sur bg`, fg: d.ink, bg: d.bg, min: 4.5 },
    { label: `${tag} — ink sur surface`, fg: d.ink, bg: d.surface, min: 4.5 },
    { label: `${tag} — accent sur bg (liens/boutons)`, fg: accent, bg: d.bg, min: 3 },
  ];
}

/* brand/ contient aussi des fichiers qui ne sont pas des marques
 * (clients.example.json, partners.json). On ne retient que ceux qui en ont la
 * forme : un slug et un bloc colors. */
async function loadBrands() {
  const files = (await readdir(join(root, "brand"))).filter((f) => f.endsWith(".json"));
  const brands = [];
  for (const f of files) {
    try {
      const b = JSON.parse(await readFile(join(root, "brand", f), "utf-8"));
      if (b?.slug && b?.colors?.accent) brands.push(b);
    } catch {
      /* fichier non parsable → ignoré ici, build-brand le signalera */
    }
  }
  return brands.sort((a, b) => a.slug.localeCompare(b.slug));
}

const brands = await loadBrands();
if (brands.length === 0) {
  console.error("❌ Aucune marque exploitable trouvée dans brand/");
  process.exit(1);
}

const PAIRS = [...brands.flatMap(pairsForBrand), ...LIGHT_PAIRS];

let failed = 0;
console.log(
  `\n🎨 Audit contraste WCAG 2.2 AA — ${brands.length} marque(s) : ${brands.map((b) => b.slug).join(", ")}\n`,
);
for (const p of PAIRS) {
  const ratio = contrast(p.fg, p.bg);
  const ok = ratio >= p.min;
  if (!ok) failed++;
  console.log(`  ${ok ? "✅" : "❌"}  ${p.label}: ${ratio.toFixed(2)}:1 (min ${p.min}:1)`);
}
console.log(failed === 0 ? "\n✅ Tous les couples passent AA.\n" : `\n❌ ${failed} échec(s).\n`);
process.exit(failed === 0 ? 0 : 1);
