/* Limite anti-abus des beacons (audit A3) : plafond par clientId sur 60 s.
   Test pur (pas de DB, pas de HTTP) — on pilote le temps via le 2e arg de
   beaconAllowed. */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  beaconAllowed,
  newSessionAllowed,
  resetBeaconLimitForTests,
} from "../src/services/beacon-limit.ts";

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

/* ── Plafond de création de sessions par IP (le bot à clientId jetable) ── */

test("création de sessions : sous le plafond, 10 clientIds neufs passent", () => {
  for (let i = 0; i < 10; i++) {
    assert.equal(newSessionAllowed("1.2.3.4", `neuf-${i}`, T0 + i * 100), true);
  }
});

test("création de sessions : le 11e clientId neuf de la minute est droppé", () => {
  for (let i = 0; i < 10; i++) newSessionAllowed("5.6.7.8", `neuf-${i}`, T0 + i * 100);
  assert.equal(newSessionAllowed("5.6.7.8", "neuf-10", T0 + 1_100), false);
});

test("création de sessions : une session déjà vue n'est jamais pénalisée", () => {
  // L'IP sature son quota, la 1re session incluse.
  for (let i = 0; i < 10; i++) newSessionAllowed("9.9.9.9", `s-${i}`, T0 + i * 100);
  assert.equal(newSessionAllowed("9.9.9.9", "s-neuf", T0 + 1_100), false, "quota saturé");
  // Les heartbeats des sessions déjà établies continuent de passer.
  assert.equal(newSessionAllowed("9.9.9.9", "s-0", T0 + 1_200), true);
  assert.equal(newSessionAllowed("9.9.9.9", "s-9", T0 + 1_300), true);
});

test("création de sessions : IPs indépendantes", () => {
  for (let i = 0; i < 10; i++) newSessionAllowed("10.0.0.1", `a-${i}`, T0 + i * 100);
  assert.equal(newSessionAllowed("10.0.0.1", "a-10", T0 + 1_100), false);
  assert.equal(
    newSessionAllowed("10.0.0.2", "b-0", T0 + 1_100),
    true,
    "une autre IP n'est pas pénalisée",
  );
});

test("création de sessions : même clientId depuis une autre IP = nouvelle session", () => {
  // Le cache est indexé par (ip, clientId) : un clientId volé et rejoué depuis
  // une IP différente doit reconsommer du quota, pas hériter du laissez-passer.
  assert.equal(newSessionAllowed("172.16.0.1", "partage", T0), true);
  for (let i = 0; i < 10; i++) newSessionAllowed("172.16.0.2", `x-${i}`, T0 + i * 100);
  assert.equal(newSessionAllowed("172.16.0.2", "partage", T0 + 1_100), false);
});

test("création de sessions : la fenêtre glisse après 60 s", () => {
  for (let i = 0; i < 10; i++) newSessionAllowed("192.168.1.1", `w-${i}`, T0 + i * 100);
  assert.equal(newSessionAllowed("192.168.1.1", "w-10", T0 + 1_100), false, "saturé");
  assert.equal(
    newSessionAllowed("192.168.1.1", "w-11", T0 + 61_000),
    true,
    "la fenêtre a glissé",
  );
});
