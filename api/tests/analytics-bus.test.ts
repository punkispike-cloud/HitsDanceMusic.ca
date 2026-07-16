/* Tests du bus d'événements analytics (fan-out temps réel intra-instance).
   Logique pure (EventEmitter) → aucune DB requise. Vérifie : réception par radio,
   isolation entre radios, désabonnement, fan-out multi-clients, et non-échec sans
   auditeur. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { emitAnalyticsBeacon, onAnalyticsBeacon } from "../src/services/analytics-bus.ts";

test("onAnalyticsBeacon : reçoit un événement pour sa radio", () => {
  let calls = 0;
  const off = onAnalyticsBeacon("radio-a", () => { calls++; });
  emitAnalyticsBeacon("radio-a");
  assert.equal(calls, 1);
  off();
});

test("onAnalyticsBeacon : n reçoit PAS les événements d'une autre radio", () => {
  let calls = 0;
  const off = onAnalyticsBeacon("radio-a", () => { calls++; });
  emitAnalyticsBeacon("radio-b");
  assert.equal(calls, 0, "un événement d'une autre radio ne doit pas déclencher");
  off();
});

test("onAnalyticsBeacon : le désabonnement arrête la réception", () => {
  let calls = 0;
  const off = onAnalyticsBeacon("radio-a", () => { calls++; });
  off();
  emitAnalyticsBeacon("radio-a");
  assert.equal(calls, 0, "après off(), plus aucune réception");
});

test("onAnalyticsBeacon : fan-out vers plusieurs clients de la même radio", () => {
  let a = 0;
  let b = 0;
  const offA = onAnalyticsBeacon("radio-a", () => { a++; });
  const offB = onAnalyticsBeacon("radio-a", () => { b++; });
  emitAnalyticsBeacon("radio-a");
  assert.equal(a, 1);
  assert.equal(b, 1, "plusieurs clients connectés reçoivent tous l'événement");
  offA();
  offB();
});

test("emitAnalyticsBeacon : ne lève pas même sans auditeur inscrit", () => {
  assert.doesNotThrow(() => emitAnalyticsBeacon("radio-solo"));
});

test("onAnalyticsBeacon : un client désabonné n'affecte pas les autres", () => {
  let remaining = 0;
  const offA = onAnalyticsBeacon("radio-a", () => { /* désabonné plus loin */ });
  const offB = onAnalyticsBeacon("radio-a", () => { remaining++; });
  offA();
  emitAnalyticsBeacon("radio-a");
  assert.equal(remaining, 1, "le client B reçoit toujours après le désabonnement de A");
  offB();
});
