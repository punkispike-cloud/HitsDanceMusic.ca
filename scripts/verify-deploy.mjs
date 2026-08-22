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
    detail: async () => {
      const r = await get("/v1/push/vapid-public-key");
      if (r.status !== 200) return null;
      return r.json?.enabled ? "VAPID actif" : "VAPID absent (503 push_disabled)";
    },
  },
  {
    name: "Créneau courant /v1/schedule/now (enrichi)",
    run: async () => {
      const r = await get("/v1/schedule/now");
      // null (aucun créneau) ou objet avec isLive + next (enrichi 2c).
      if (r.status !== 200) return false;
      if (r.json === null) return true;
      return typeof r.json?.isLive === "boolean" && "next" in r.json;
    },
  },
  {
    name: "Route pubs/jingles /v1/admin/media (présente, auth requise)",
    run: async () => {
      const r = await get("/v1/admin/media");
      // 401/403 = la route existe et exige l'auth ; 404 = route absente.
      return r.status === 401 || r.status === 403;
    },
  },
  {
    name: "Webhook Stripe /v1/webhooks/stripe (gated safe)",
    run: async () => {
      // POST non signé attendu. Deux états sains, selon la configuration :
      //   503 = stripe_disabled (STRIPE_WEBHOOK_SECRET absent — scaffold safe)
      //   400 = configuré et la signature manquante est REJETÉE (le bon réflexe)
      // Tout autre code (200 surtout) voudrait dire qu'un payload non signé a
      // été accepté. On ne fabrique jamais de signature ici.
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT);
      try {
        const p = await fetch(`${base}/v1/webhooks/stripe`, {
          method: "POST",
          signal: ctrl.signal,
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        return p.status === 503 || p.status === 400;
      } catch {
        return false;
      } finally {
        clearTimeout(t);
      }
    },
  },
];

console.log(`\n🔍 Vérification de ${base}\n`);
let failed = 0;
for (const c of checks) {
  let ok = false;
  try { ok = await c.run(); } catch { ok = false; }
  if (!ok) failed++;
  let extra = "";
  if (c.detail) {
    try {
      const d = await c.detail();
      if (d) extra = ` (${d})`;
    } catch { /* ignore */ }
  }
  console.log(`  ${ok ? "✅" : "❌"}  ${c.name}${extra}`);
}

/* Armement de l'observabilité — AVERTISSEMENT, pas échec (audit 2026-08-21).
   Ce script répond à « le déploiement est-il fonctionnel ? » ; c'est
   pre-go-live.mjs (check #9) qui répond à « peut-on mettre en ondes ? » et qui
   BLOQUE dessus. Le distinguer évite de rendre le job staging rouge en
   permanence : une vérification toujours rouge finit par être ignorée, ce qui
   est précisément le mécanisme qui a laissé l'angle mort s'installer. */
try {
  const h = await get("/health");
  const j = h.json;
  if (j && typeof j === "object" && typeof j.alerts === "boolean") {
    if (!j.alerts) {
      console.log(
        j.monitor
          ? "\n  ⚠️   Observabilité : surveillance ACTIVE sans canal d'alerte — un dead-air ne préviendra personne (RESEND_API_KEY)."
          : "\n  ⚠️   Observabilité : ni surveillance ni canal d'alerte (MONITOR_ENABLED + RESEND_API_KEY).",
      );
    }
    if (!j.sentry) console.log("  ⚠️   Observabilité : SENTRY_DSN absent — exceptions non capturées.");
    if (j.alerts && j.sentry) console.log("\n  ✅  Observabilité armée (alertes + Sentry).");
  } else {
    console.log("\n  ⚠️   /health n'expose pas monitor/alerts/sentry — API antérieure au correctif, à redéployer.");
  }
} catch {
  /* /health déjà couvert par le premier check — on n'ajoute pas de bruit ici. */
}

console.log(
  failed === 0
    ? "\n✅ Tout est vert — le client est en ligne.\n"
    : `\n❌ ${failed} vérification(s) en échec — voir ci-dessus.\n`,
);
process.exit(failed === 0 ? 0 : 1);
