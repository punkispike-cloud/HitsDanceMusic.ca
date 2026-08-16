/* Limite anti-abus des beacons (audit A3) : plafond par clientId sur 60 s.
   Test pur (pas de DB, pas de HTTP) — on pilote le temps via le 2e arg de
   beaconAllowed. */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { beaconAllowed, resetBeaconLimitForTests } from "../src/services/beacon-limit.ts";

beforeEach(() => resetBeaconLimitForTests());

const T0 = 1_000_000; // un instant arbitraire (ms)

test("sous le plafond : tous acceptés", () => {
  // 3/min attendus, plafond à 8 → 8 acceptés.
  for (let i = 0; i < 8; i++) assert.equal(beaconAllowed("c1", T0 + i * 100), true);
});

test("au-delà du plafond : droppé", () => {
  for (let i = 0; i < 8; i++) beaconAllowed("c2", T0 + i * 100);
  assert.equal(beaconAllowed("c2", T0 + 8 * 100), false, "le 9e sur 60 s est droppé");
});

test("clientIds indépendants", () => {
  for (let i = 0; i < 8; i++) beaconAllowed("a", T0 + i * 100);
  assert.equal(beaconAllowed("a", T0 + 8 * 100), false);
  assert.equal(beaconAllowed("b", T0 + 8 * 100), true, "un autre clientId n'est pas pénalisé");
});

test("fenêtre glissante : après 60 s écoulées, la fenêtre se vide", () => {
  // 8 hits sur 1 s (sous T0), tous acceptés → le clientId est saturé.
  for (let i = 0; i < 8; i++) beaconAllowed("c3", T0 + i * 100);
  assert.equal(beaconAllowed("c3", T0 + 500), false, "saturé sur la fenêtre courante");
  // 61 s plus tard : tous les anciens hits sont hors fenêtre (now - t >= 60_000),
  // la fenêtre est vide → un nouveau hit est accepté.
  assert.equal(beaconAllowed("c3", T0 + 61_000), true, "la fenêtre a glissé");
  // Immédiatement après, un 2e hit est accepté (1 récent seulement).
  assert.equal(beaconAllowed("c3", T0 + 61_050), true);
});

test("un clientId droppé le reste tant que la fenêtre est saturée", () => {
  for (let i = 0; i < 8; i++) beaconAllowed("c4", T0 + i * 100);
  // Plusieurs tentatives rapprochées : toutes droppées (on ne rafraîchit pas avec un nouveau hit).
  assert.equal(beaconAllowed("c4", T0 + 500), false);
  assert.equal(beaconAllowed("c4", T0 + 1_000), false);
});
