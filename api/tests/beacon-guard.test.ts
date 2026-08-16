/* Garde anti-pollution A3 : cap de création de nouvelles sessions par IP.
   Exporte beaconAllowed depuis track.ts — pas de DB, pas de HTTP. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { beaconAllowed } from "../src/routes/track.ts";

test("beaconAllowed : 10 nouvelles sessions/IP/min passent, la 11e est droppée", () => {
  const ip = `guard-cap-${Date.now()}`;
  for (let i = 0; i < 10; i++) {
    assert.equal(beaconAllowed(ip, `client-${i}`), true, `session ${i} acceptée`);
  }
  assert.equal(beaconAllowed(ip, "client-overflow"), false, "11e session droppée");
});

test("beaconAllowed : une session déjà connue passe même après le quota", () => {
  const ip = `guard-known-${Date.now()}`;
  assert.equal(beaconAllowed(ip, "habitué"), true);
  // Remplit le quota avec d'autres clientId.
  for (let i = 0; i < 12; i++) beaconAllowed(ip, `other-${i}`);
  assert.equal(beaconAllowed(ip, "habitué"), true, "session établie toujours acceptée");
});

test("beaconAllowed : deux IP distinctes ont des quotas indépendants", () => {
  const t = Date.now();
  const ipA = `guard-a-${t}`;
  const ipB = `guard-b-${t}`;
  for (let i = 0; i < 10; i++) assert.equal(beaconAllowed(ipA, `a-${i}`), true);
  assert.equal(beaconAllowed(ipA, "a-overflow"), false);
  assert.equal(beaconAllowed(ipB, "b-first"), true, "IP B n'est pas affectée par le quota de A");
});
