/* Vérifie que le pipeline seed → sérialisation reproduit SCHEDULE à
   l'identique. C'est la garantie clé pour le futur branchement du front
   (la grille servie par l'API doit être structurellement identique).
   Run : npm test */

import { test } from "node:test";
import assert from "node:assert/strict";
import { SCHEDULE } from "../src/db/seed-data.ts";
import { toMinutes, fromMinutes, slotTagSchema } from "../src/lib/validation.ts";

// Reproduit la logique du seed (start/end en minutes) puis celle de
// services/schedule.ts (re-sérialisation en "HH:MM" / "24:00").
function roundTrip(from: string, to: string): [string, string] {
  const startMin = toMinutes(from);
  const endMin = to === "24:00" ? 1440 : toMinutes(to);
  assert.ok(startMin != null, `from invalide: ${from}`);
  assert.ok(endMin != null, `to invalide: ${to}`);
  return [fromMinutes(startMin!), fromMinutes(endMin!)];
}

test("SCHEDULE — round-trip minutes sans perte (incl. 24:00)", () => {
  for (let day = 0; day <= 6; day++) {
    for (const [from, to, title] of SCHEDULE[day] ?? []) {
      const [rtFrom, rtTo] = roundTrip(from, to);
      assert.equal(rtFrom, from, `from altéré (${day}, ${title})`);
      assert.equal(rtTo, to, `to altéré (${day}, ${title})`);
    }
  }
});

test("SCHEDULE — tous les tags sont des slot_tag valides", () => {
  for (let day = 0; day <= 6; day++) {
    for (const [, , , , tag] of SCHEDULE[day] ?? []) {
      assert.doesNotThrow(() => slotTagSchema.parse(tag), `tag invalide: ${tag}`);
    }
  }
});

test("SCHEDULE — couverture 24h continue par jour (pas de trou ni chevauchement)", () => {
  for (let day = 0; day <= 6; day++) {
    const rows = (SCHEDULE[day] ?? []).map(([from, to]) => ({
      start: toMinutes(from)!,
      end: to === "24:00" ? 1440 : toMinutes(to)!,
    }));
    rows.sort((a, b) => a.start - b.start);
    assert.equal(rows[0]?.start, 0, `jour ${day} ne commence pas à 00:00`);
    for (let i = 1; i < rows.length; i++) {
      assert.equal(rows[i]!.start, rows[i - 1]!.end, `jour ${day} : trou/chevauchement à l'index ${i}`);
    }
    assert.equal(rows[rows.length - 1]?.end, 1440, `jour ${day} ne finit pas à 24:00`);
  }
});

test("toMinutes / fromMinutes — cas limites", () => {
  assert.equal(toMinutes("00:00"), 0);
  assert.equal(toMinutes("16:30"), 990);
  assert.equal(fromMinutes(0), "00:00");
  assert.equal(fromMinutes(1440), "24:00");
  assert.equal(fromMinutes(990), "16:30");
  assert.equal(toMinutes("bad"), null);
});
