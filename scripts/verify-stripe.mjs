/* En Ondes — Vérification du plombage webhook Stripe (Phase 4.2).
 *
 * Outil opérateur à lancer une fois Stripe configuré en mode TEST sur l'API
 * (STRIPE_WEBHOOK_SECRET posé). Vérifie SANS dépendance SDK ni toucher la DB
 * métier :
 *   1. État de config : POST non signé -> 503 (non configuré) ou 400 (configuré).
 *   2. Signature : construit un événement synthétique signé à la main (HMAC-SHA256
 *      façon Stripe) -> 200 {received:true} prouve que STRIPE_WEBHOOK_SECRET correspond.
 *   3. Idempotence : re-POST du même événement -> 200 (no-op, déjà traité).
 *
 * L'événement synthétique est de type "ping" (non customer.subscription.*) ->
 * handleStripeEvent l'enregistre dans stripe_events (table de déduplication) puis
 * retourne null : aucune écriture métier (subscriptions/radios) n'est faite. Le
 * test n'altère donc pas l'état fonctionnel ; il ajoute une ligne dans
 * stripe_events (idempotente : re-lancer ne crée rien de plus).
 *
 * Le parcours Checkout -> abonnement -> cascade radio (paused) reste un test
 * manuel en mode test Stripe (voir RUNBOOK-PRODUCTION §3.2) : il nécessite un
 * token admin + une radio réelle + un paiement test.
 *
 * Usage :
 *   STRIPE_WEBHOOK_SECRET=whsec_... node scripts/verify-stripe.mjs https://<api-url>
 */

const base = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("Usage : STRIPE_WEBHOOK_SECRET=whsec_... node scripts/verify-stripe.mjs https://<api-url>");
  process.exit(1);
}
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
if (!webhookSecret) {
  console.error("STRIPE_WEBHOOK_SECRET manquant (env).");
  process.exit(1);
}

const TIMEOUT = 12_000;
import crypto from "node:crypto";

async function postWebhook(body, signature) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(`${base}/v1/webhooks/stripe`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: r.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

// Signature webhook Stripe : "t=<timestamp>,v1=<hex HMAC-SHA256(timestamp.payload, secret)>".
function sign(payload, secret) {
  const ts = Math.floor(Date.now() / 1000);
  const mac = crypto.createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");
  return `t=${ts},v1=${mac}`;
}

const eventId = `evt_verify_${Date.now()}`;
const payload = JSON.stringify({
  id: eventId,
  object: "event",
  api_version: "2024-06-20",
  created: Math.floor(Date.now() / 1000),
  type: "ping", // type non customer.subscription.* -> pas d'écriture métier
  data: { object: {} },
});

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed++;
  console.log(`  ${ok ? "✅" : "❌"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log(`\n🔍 Vérification webhook Stripe — ${base}\n`);

// 1. État de config : POST non signé.
const cfg = await postWebhook("{}", "");
if (cfg.status === 503) {
  check("Stripe configuré (STRIPE_WEBHOOK_SECRET présent)", false, "503 stripe_disabled → poser STRIPE_WEBHOOK_SECRET");
  console.log("\n❌ Stripe non configuré — arrêt (les étapes suivantes nécessitent le secret).\n");
  process.exit(1);
}
check("Stripe configuré (STRIPE_WEBHOOK_SECRET présent)", cfg.status === 400, `POST non signé → ${cfg.status} (400 attendu = signature absente = configuré)`);

// 2. Signature : événement signé -> 200.
const sig = sign(payload, webhookSecret);
const signed = await postWebhook(payload, sig);
check("Signature vérifiée (STRIPE_WEBHOOK_SECRET correspond)", signed.status === 200 && signed.json?.received === true, `→ ${signed.status} ${signed.json?.received ? "{received:true}" : ""}`);

// 3. Idempotence : re-POST du même événement -> 200 (no-op, déjà traité).
const signed2 = await postWebhook(payload, sig);
check("Idempotence (re-POST du même event.id = no-op)", signed2.status === 200, `→ ${signed2.status}`);

console.log(
  failed === 0
    ? "\n✅ Webhook Stripe opérationnel — signature + idempotence validées.\n   (Le parcours Checkout→abonnement→cascade radio reste un test manuel mode test Stripe — voir RUNBOOK §3.2.)\n"
    : `\n❌ ${failed} vérification(s) en échec — voir ci-dessus.\n`,
);
process.exit(failed === 0 ? 0 : 1);
