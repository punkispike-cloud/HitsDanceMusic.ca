/* Tests du service Stripe : mapping palier <-> Price ID (depuis l'env) et traduction
   des statuts d'abonnement Stripe vers l'enum local. Fonctions pures — aucun appel
   au SDK Stripe ni à la DB. Le Pool Postgres est fermé en fin de suite pour un exit
   propre (le module stripe.ts importe db/client). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { tierToPriceId, priceIdToTier, mapStripeStatus, BILLABLE_TIERS } from "../src/services/stripe.ts";
import { closeDb } from "../src/db/client.ts";

test("tierToPriceId : lit les Price IDs depuis l'env, null si absent", () => {
  process.env.STRIPE_PRICE_STARTER_ID = "price_starter_123";
  process.env.STRIPE_PRICE_GROWTH_ID = "price_growth_456";
  delete process.env.STRIPE_PRICE_PRO_ID;
  assert.equal(tierToPriceId("starter"), "price_starter_123");
  assert.equal(tierToPriceId("growth"), "price_growth_456");
  assert.equal(tierToPriceId("pro"), null);
  assert.equal(tierToPriceId("beyond"), null); // palier « sur devis », hors mapping
});

test("priceIdToTier : reverse mapping depuis l'env", () => {
  process.env.STRIPE_PRICE_STARTER_ID = "price_starter_123";
  process.env.STRIPE_PRICE_GROWTH_ID = "price_growth_456";
  assert.equal(priceIdToTier("price_starter_123"), "starter");
  assert.equal(priceIdToTier("price_growth_456"), "growth");
  assert.equal(priceIdToTier("price_inconnu"), null);
  assert.equal(priceIdToTier(null), null);
  assert.equal(priceIdToTier(undefined), null);
});

test("BILLABLE_TIERS : starter, growth, pro (pas beyond)", () => {
  assert.deepEqual([...BILLABLE_TIERS].sort(), ["growth", "pro", "starter"]);
});

test("mapStripeStatus : mappe les statuts Stripe vers l'enum local", () => {
  assert.equal(mapStripeStatus("active"), "active");
  assert.equal(mapStripeStatus("trialing"), "trialing");
  assert.equal(mapStripeStatus("past_due"), "past_due");
  assert.equal(mapStripeStatus("unpaid"), "past_due");
  assert.equal(mapStripeStatus("incomplete"), "incomplete");
  assert.equal(mapStripeStatus("canceled"), "canceled");
  assert.equal(mapStripeStatus("incomplete_expired"), "canceled");
  assert.equal(mapStripeStatus("whatever"), "incomplete");
  assert.equal(mapStripeStatus(undefined), "incomplete");
});

test("nettoyage : ferme le pool DB pour un exit propre", async () => {
  await closeDb();
});
