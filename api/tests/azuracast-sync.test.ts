/* Synchro rotations → AzuraCast : conversions pures fenêtre horaire / jours.
   (La synchro réseau elle-même est gated par AZURACAST_BASE_URL et sera validée
   sur une vraie instance — cf. note « À VALIDER » dans services/azuracast.ts.) */

import test from "node:test";
import assert from "node:assert/strict";
import { toAzuraTime, toAzuraDays } from "../src/services/azuracast.js";

test("toAzuraTime : minutes depuis minuit → entier HHMM", () => {
  assert.equal(toAzuraTime(0), 0); // 00:00
  assert.equal(toAzuraTime(390), 630); // 06:30
  assert.equal(toAzuraTime(755), 1235); // 12:35
  assert.equal(toAzuraTime(1439), 2359); // 23:59
});

test("toAzuraTime : 1440 (fin de journée) → 0 (minuit, convention AzuraCast)", () => {
  assert.equal(toAzuraTime(1440), 0);
});

test("toAzuraDays : 0=dimanche..6=samedi → ISO 1=lundi..7=dimanche", () => {
  assert.deepEqual(toAzuraDays(0), [7]); // dimanche
  assert.deepEqual(toAzuraDays(1), [1]); // lundi
  assert.deepEqual(toAzuraDays(6), [6]); // samedi
});

test("toAzuraDays : -1 (tous les jours) → null (pas de restriction)", () => {
  assert.equal(toAzuraDays(-1), null);
});
