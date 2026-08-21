/* Contrat de /health : les champs d'ARMEMENT de l'observabilité (audit
   2026-08-21). Deux consommateurs en dépendent hors du code applicatif —
   scripts/pre-go-live.mjs (check #9, BLOQUANT) et scripts/verify-deploy.mjs —
   et aucun ne casserait bruyamment si les champs disparaissaient : ils
   dégraderaient en « API antérieure au correctif », donc en silence. D'où ce
   test : c'est le seul endroit où la suppression d'un champ vire au rouge.

   Aucune DB réelle : pingDb() échoue (ECONNREFUSED sur la base de test) et
   /health répond 503 — c'est attendu et sans conséquence ici, les champs
   d'armement sont émis dans les deux cas. */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { healthRoutes } from "../src/routes/health.ts";
import { isMonitorEnabled, isResendConfigured, isSentryConfigured } from "../src/env.ts";
import { closeDb } from "../src/db/client.ts";

after(async () => {
  await closeDb();
});

test("/health expose monitor, alerts et sentry en booléens", async () => {
  const res = await healthRoutes.request("/health");
  const body = (await res.json()) as Record<string, unknown>;

  assert.equal(typeof body.monitor, "boolean", "champ `monitor` absent de /health");
  assert.equal(typeof body.alerts, "boolean", "champ `alerts` absent de /health");
  assert.equal(typeof body.sentry, "boolean", "champ `sentry` absent de /health");
});

test("/health reflète l'état réel de la configuration", async () => {
  const res = await healthRoutes.request("/health");
  const body = (await res.json()) as Record<string, unknown>;

  assert.equal(body.monitor, isMonitorEnabled());
  assert.equal(body.alerts, isResendConfigured());
  assert.equal(body.sentry, isSentryConfigured());
});

test("sans RESEND_API_KEY, aucun canal d'alerte n'est annoncé", async () => {
  /* Le défaut trouvé en production : RESEND_API_KEY absent ⇒ monitor.ts détecte
     un dead-air puis `return` sans rien envoyer. En test la clé n'est jamais
     posée, donc on vérifie que /health le DIT au lieu de le taire. */
  assert.equal(isResendConfigured(), false, "test à revoir : RESEND_API_KEY posé dans l'env de test");

  const res = await healthRoutes.request("/health");
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.alerts, false);
});
