/* Tests : helpers temps. Run : node --test tests/time.test.mjs */

import { test } from "node:test";
import assert from "node:assert/strict";
import { toMinutes, getMontrealParts, DAY_NAMES, TIMEZONE } from "../js/time.js";

test("toMinutes — formats HH:MM standards", () => {
  assert.equal(toMinutes("00:00"), 0);
  assert.equal(toMinutes("07:00"), 420);
  assert.equal(toMinutes("12:30"), 750);
  assert.equal(toMinutes("23:59"), 1439);
});

test("toMinutes — minuit dans la grille (24:00)", () => {
  assert.equal(toMinutes("24:00"), 1440);
});

test("DAY_NAMES — 7 jours dans l'ordre Dim → Sam", () => {
  assert.equal(DAY_NAMES.length, 7);
  assert.equal(DAY_NAMES[0], "Dimanche");
  assert.equal(DAY_NAMES[1], "Lundi");
  assert.equal(DAY_NAMES[6], "Samedi");
});

test("TIMEZONE = America/Toronto (heure Québec)", () => {
  assert.equal(TIMEZONE, "America/Toronto");
});

test("getMontrealParts retourne {day, hour, minute, second}", () => {
  const p = getMontrealParts(new Date("2026-05-13T18:30:45Z"));
  assert.ok(typeof p.day === "number" && p.day >= 0 && p.day <= 6);
  assert.ok(typeof p.hour === "number" && p.hour >= 0 && p.hour < 24);
  assert.ok(typeof p.minute === "number" && p.minute >= 0 && p.minute < 60);
  assert.ok(typeof p.second === "number" && p.second >= 0 && p.second < 60);
});

test("getMontrealParts convertit UTC → heure locale Toronto", () => {
  // 2026-05-13 18:30 UTC = 14:30 EDT (Toronto en DST)
  const p = getMontrealParts(new Date("2026-05-13T18:30:00Z"));
  assert.equal(p.hour, 14);
  assert.equal(p.minute, 30);
  // 13 mai 2026 est un mercredi → day = 3
  assert.equal(p.day, 3);
});

test("getMontrealParts — minuit Québec passe au jour suivant", () => {
  // 2026-05-13 05:00 UTC = 01:00 EDT mercredi à Toronto
  const p = getMontrealParts(new Date("2026-05-13T05:00:00Z"));
  assert.equal(p.hour, 1);
  assert.equal(p.day, 3); // mercredi
});
