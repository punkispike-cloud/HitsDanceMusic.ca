/* Tests : grille de programmation — getCurrentSlot / getNextSlot.
   Run : node --test tests/schedule.test.mjs

   Note : on construit la Date en UTC en compensant le décalage EDT (Toronto -4h
   en été, -5h en hiver) pour cibler une heure locale Toronto précise. Les tests
   ci-dessous utilisent des dates en mai 2026 → EDT (UTC-4). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { getCurrentSlot, getNextSlot, SCHEDULE, SLOT_TAGS } from "../js/schedule.js";

// Helper : construit une Date dont l'heure locale Toronto sera exactement les valeurs données.
// 2026-05-XX est en EDT (UTC-4), donc UTC = local + 4h.
function tor(year, month, day, hour, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour + 4, minute));
}

test("SCHEDULE — 7 jours définis (0=Dim → 6=Sam)", () => {
  for (let d = 0; d < 7; d++) {
    assert.ok(Array.isArray(SCHEDULE[d]), `SCHEDULE[${d}] absent`);
    assert.ok(SCHEDULE[d].length > 0, `SCHEDULE[${d}] vide`);
  }
});

test("SLOT_TAGS — couleurs et labels présents", () => {
  for (const key of ["morning","hitlist","drive","limelight","night","special","audition"]) {
    assert.ok(SLOT_TAGS[key], `tag ${key} absent`);
    // Hex CSS : forme courte (#666) ou longue (#666666)
    assert.match(SLOT_TAGS[key].color, /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i);
    assert.ok(SLOT_TAGS[key].label);
  }
});

test("getCurrentSlot — lundi 07h30 = matin d'Alain (07-09)", () => {
  // 2026-05-11 = lundi (day=1)
  const slot = getCurrentSlot(tor(2026, 5, 11, 7, 30));
  assert.equal(slot.day, 1);
  assert.equal(slot.from, "07:00");
  assert.equal(slot.to, "09:00");
  assert.match(slot.title, /matins.*Alain/i);
  assert.equal(slot.tag, "morning");
});

test("getCurrentSlot — mercredi 16h30 = Hit Drive (16-18)", () => {
  // 2026-05-13 = mercredi
  const slot = getCurrentSlot(tor(2026, 5, 13, 16, 30));
  assert.equal(slot.day, 3);
  assert.equal(slot.from, "16:00");
  assert.equal(slot.to, "18:00");
  assert.match(slot.title, /Hit Drive/);
  assert.equal(slot.tag, "drive");
});

test("getCurrentSlot — minuit (00:00) tombe sur la nuit BeatRadioWorld", () => {
  // Vendredi 00:00
  const slot = getCurrentSlot(tor(2026, 5, 15, 0, 0));
  assert.equal(slot.from, "00:00");
  assert.equal(slot.tag, "night");
});

test("getCurrentSlot — 23:00 (avant minuit) tombe sur le slot nuit qui finit à 24:00", () => {
  // Jeudi 23:00 — slot 22:00-24:00 (night)
  const slot = getCurrentSlot(tor(2026, 5, 14, 23, 0));
  assert.equal(slot.to, "00:00"); // 24:00 est exposé comme "00:00"
  assert.equal(slot.tag, "night");
});

test("getNextSlot — lundi 07h30 → Hit List à 09:00 (même jour)", () => {
  const next = getNextSlot(tor(2026, 5, 11, 7, 30));
  assert.equal(next.sameDay, true);
  assert.equal(next.from, "09:00");
});

test("getNextSlot — lundi 23h59 → premier slot de mardi 00:00", () => {
  const next = getNextSlot(tor(2026, 5, 11, 23, 59));
  assert.equal(next.sameDay, false);
  assert.equal(next.from, "00:00");
  assert.equal(next.day, 2); // mardi
});

test("getCurrentSlot — chaque jour 24h sont couvertes (pas de trou)", () => {
  for (let d = 0; d < 7; d++) {
    const slots = SCHEDULE[d];
    // Vérifier que le premier slot commence à 00:00
    assert.equal(slots[0][0], "00:00", `Jour ${d} ne commence pas à 00:00`);
    // Vérifier que le dernier slot finit à 24:00
    assert.equal(slots[slots.length - 1][1], "24:00", `Jour ${d} ne finit pas à 24:00`);
    // Vérifier la continuité (chaque slot.to = next slot.from)
    for (let i = 0; i < slots.length - 1; i++) {
      assert.equal(slots[i][1], slots[i+1][0],
        `Jour ${d}, trou entre slot ${i} (${slots[i][1]}) et slot ${i+1} (${slots[i+1][0]})`);
    }
  }
});
