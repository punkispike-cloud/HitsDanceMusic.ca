/* Vérifie les ratios de contraste WCAG 2.2 AA des tokens de design (--ink, --muted, --accent).
 * Usage : node scripts/check-contrast.mjs
 * Exit 1 si un couple texte/fond échoue le seuil AA (4.5:1 texte normal, 3:1 texte large).
 */

const PAIRS = [
  { label: "dark — muted sur bg", fg: "#9a9a9a", bg: "#0a0a0a", min: 4.5 },
  { label: "dark — muted sur surface", fg: "#9a9a9a", bg: "#1a1a1a", min: 4.5 },
  { label: "dark — ink sur bg", fg: "#f5f5f5", bg: "#0a0a0a", min: 4.5 },
  { label: "dark — accent sur bg (liens/boutons)", fg: "#c8102e", bg: "#0a0a0a", min: 3 },
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

let failed = 0;
console.log("\n🎨 Audit contraste WCAG 2.2 AA — tokens design\n");
for (const p of PAIRS) {
  const ratio = contrast(p.fg, p.bg);
  const ok = ratio >= p.min;
  if (!ok) failed++;
  console.log(`  ${ok ? "✅" : "❌"}  ${p.label}: ${ratio.toFixed(2)}:1 (min ${p.min}:1)`);
}
console.log(failed === 0 ? "\n✅ Tous les couples passent AA.\n" : `\n❌ ${failed} échec(s).\n`);
process.exit(failed === 0 ? 0 : 1);
