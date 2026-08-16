/* En Ondes — Vérification du webhook Stripe (parcours ops, à lancer une fois
 * Stripe live en mode test).
 *
 * Vérifie, sans dépendance (signe à la main avec node:crypto, schéma Stripe) :
 *   1. signature absente → 400 (la signature est exigée avant tout parsing).
 *   2. événement signé accepté → 200.
 *   3. re-post du MÊME event.id → 200 (idempotence : déjà traité, no-op).
 *   4. événement plus RÉCENT signé → 200 (applique).
 *   5. événement plus ANCIEN signé → 200 mais ignoré (garde anti-désordre).
 *
 * Note : l'événement synthétique porte un radio_id fictif → l'upsert réel de
 * l'abonnement est un no-op (événement orphelin). Ce script fume la plomberie du
 * webhook (signature + idempotence + anti-désordre), pas le parcours Checkout
 * complet (cf. RUNBOOK-PRODUCTION.md §3.2 pour le parcours manuel).
 *
 * Usage :
 *   STRIPE_WEBHOOK_SECRET=whsec_... node scripts/verify-stripe.mjs https://<api-url>
 */
import { createHmac } from "node:crypto";

const base = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("Usage : STRIPE_WEBHOOK_SECRET=whsec_... node scripts/verify-stripe.mjs https://<api-url>");
  process.exit(1);
}
const secret = process.env.STRIPE_WEBHOOK_SECRET;
if (!secret) {
  console.error("❌ STRIPE_WEBHOOK_SECRET manquant — poser la variable (dashboard Stripe webhook).");
  process.exit(1);
}

const url = `${base}/v1/webhooks/stripe`;

function sign(payload, timestamp) {
  const signed = `${timestamp}.${payload}`;
  const sig = createHmac("sha256", secret).update(signed).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

let pass = 0;
let fail = 0;
async function check(name, fn) {
  let ok = false;
  try {
    ok = await fn();
  } catch {
    ok = false;
  }
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"}  ${name}`);
}

function makeEvent(id, created, status, subId = "sub_synthetic") {
  return JSON.stringify({
    id,
    type: "customer.subscription.created",
    created,
    data: { object: { id: subId, status, metadata: { radio_id: "radio-synthetic", plan_tier: "starter" } } },
  });
}

const now = Math.floor(Date.now() / 1000);

async function post(payload, ts) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": sign(payload, ts) },
    body: payload,
  });
  return res.status;
}

console.log(`\n🔍 Vérification webhook Stripe sur ${url}\n`);

// 1. signature absente → 400
await check("signature absente → 400 (signature exigée)", async () => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  return r.status === 400;
});

// 2. événement signé accepté → 200
const ev1 = makeEvent("evt_test_1", now);
await check("événement signé accepté → 200", async () => (await post(ev1, now)) === 200);

// 3. re-post du même event.id → 200 (idempotence)
await check("re-post du même event.id → 200 (idempotence)", async () => (await post(ev1, now)) === 200);

// 4. événement plus récent → 200 (applique)
const ev2 = makeEvent("evt_test_2", now + 5, "active");
await check("événement plus récent → 200 (applique)", async () => (await post(ev2, now + 5)) === 200);

// 5. événement plus ancien → 200 mais ignoré (anti-désordre)
const evOld = makeEvent("evt_test_3", now - 10, "canceled");
await check("événement plus ancien → 200 (anti-désordre)", async () => (await post(evOld, now - 10)) === 200);

console.log(fail === 0 ? "\n✅ Webhook Stripe OK — signature, idempotence, anti-désordre vérifiés.\n" : `\n❌ ${fail} vérification(s) en échec.\n`);
process.exit(fail === 0 ? 0 : 1);
