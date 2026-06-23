/* En Ondes — Vérification post-déploiement d'un client.
 * Teste les endpoints critiques de l'API d'un client et affiche un bilan clair.
 *
 * Usage :
 *   node scripts/verify-deploy.mjs https://<api-du-client>
 */

const base = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("Usage : node scripts/verify-deploy.mjs https://<api-du-client>");
  process.exit(1);
}

const TIMEOUT = 12_000;
async function get(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(`${base}${path}`, { signal: ctrl.signal });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: r.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

const checks = [
  {
    name: "API en vie + DB connectée",
    run: async () => {
      const r = await get("/health");
      return r.status === 200 && r.json?.ok === true && r.json?.db === true;
    },
  },
  {
    name: "Grille /v1/schedule (jours 0-6)",
    run: async () => {
      const r = await get("/v1/schedule");
      return r.status === 200 && r.json && typeof r.json === "object" && "0" in r.json;
    },
  },
  {
    name: "Animateurs /v1/artists (tableau)",
    run: async () => {
      const r = await get("/v1/artists");
      return r.status === 200 && Array.isArray(r.json);
    },
  },
  {
    name: "Web Push exposé (config gated)",
    run: async () => {
      const r = await get("/v1/push/vapid-public-key");
      return r.status === 200 && typeof r.json?.enabled === "boolean";
    },
  },
];

console.log(`\n🔍 Vérification de ${base}\n`);
let failed = 0;
for (const c of checks) {
  let ok = false;
  try { ok = await c.run(); } catch { ok = false; }
  if (!ok) failed++;
  console.log(`  ${ok ? "✅" : "❌"}  ${c.name}`);
}

console.log(
  failed === 0
    ? "\n✅ Tout est vert — le client est en ligne.\n"
    : `\n❌ ${failed} vérification(s) en échec — voir ci-dessus.\n`,
);
process.exit(failed === 0 ? 0 : 1);
