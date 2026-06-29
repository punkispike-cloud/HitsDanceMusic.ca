/* Harnais de tests des fonctions pures de admin/lib/types.ts (node --test + tsx).
   Aucun import Next/DOM : lib/types.ts est un module pur → sûr et déterministe.

   Test critique : la PARITÉ RBAC avec l'API. admin/lib/types.ts duplique les
   axes de capacité (isEditorialAdmin, isCrossRadio, ROLE_RANK/roleAtLeast) qui
   existent côté api/src/middleware/rbac.ts. Ce test garantit que les deux
   restent synchronisés : si l'un drift, la suite échoue. */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_RANK,
  ROLE_LABEL,
  roleAtLeast,
  isEditorialAdmin,
  isCrossRadio,
  formatDuration,
  tagColor,
  minToHHMM,
  hhmmToMin,
} from "../lib/types";
import type { Role, SlotTag } from "../lib/types";

const ROLES: Role[] = ["owner", "superadmin", "animateur", "lecteur", "it"];

/* ───────────────────────── Parité RBAC avec l'API ───────────────────────── */

test("parité API : isEditorialAdmin = (superadmin || owner) ; isCrossRadio = (owner || it)", () => {
  for (const r of ROLES) {
    assert.equal(isEditorialAdmin(r), r === "superadmin" || r === "owner", `isEditorialAdmin(${r})`);
    assert.equal(isCrossRadio(r), r === "owner" || r === "it", `isCrossRadio(${r})`);
  }
});

test("ROLE_RANK : hiérarchie owner > it > superadmin > animateur > lecteur (miroir API RANK)", () => {
  assert.ok(ROLE_RANK.lecteur < ROLE_RANK.animateur);
  assert.ok(ROLE_RANK.animateur < ROLE_RANK.superadmin);
  assert.ok(ROLE_RANK.superadmin < ROLE_RANK.it);
  assert.ok(ROLE_RANK.it < ROLE_RANK.owner);
});

test("roleAtLeast respecte ROLE_RANK (miroir de requireMinRole côté API)", () => {
  assert.equal(roleAtLeast("lecteur", "lecteur"), true);
  assert.equal(roleAtLeast("animateur", "lecteur"), true);
  assert.equal(roleAtLeast("owner", "lecteur"), true);
  assert.equal(roleAtLeast("it", "superadmin"), true, "it (4) >= superadmin (3)");
  assert.equal(roleAtLeast("superadmin", "it"), false, "superadmin (3) < it (4)");
  assert.equal(roleAtLeast("lecteur", "animateur"), false);
  assert.equal(roleAtLeast(null, "lecteur"), false, "null → faux");
  assert.equal(roleAtLeast(undefined, "lecteur"), false, "undefined → faux");
});

test("ROLE_LABEL : les 5 rôles ont un libellé non vide", () => {
  for (const r of ROLES) {
    assert.ok(ROLE_LABEL[r].length > 0, `ROLE_LABEL[${r}] non vide`);
  }
});

/* ───────────────────────── Fonctions de formatage ───────────────────────── */

test("formatDuration : secondes / minutes / heures", () => {
  assert.equal(formatDuration(0), "0 s");
  assert.equal(formatDuration(59), "59 s");
  assert.equal(formatDuration(60), "1 min");
  assert.equal(formatDuration(3599), "59 min");
  assert.equal(formatDuration(3600), "1 h 00");
  assert.equal(formatDuration(3660), "1 h 01");
});

test("minToHHMM : 0 / 90 / 1440", () => {
  assert.equal(minToHHMM(0), "00:00");
  assert.equal(minToHHMM(90), "01:30");
  assert.equal(minToHHMM(1440), "24:00");
});

test("hhmmToMin : valides + invalides → null", () => {
  assert.equal(hhmmToMin("01:30"), 90);
  assert.equal(hhmmToMin("24:00"), 1440);
  assert.equal(hhmmToMin("25:00"), null, "heure > 24");
  assert.equal(hhmmToMin("10:60"), null, "minutes > 59");
  assert.equal(hhmmToMin("bad"), null, "format non reconnu");
});

test("tagColor : tag connu → sa var CSS ; null/inconnu → défaut", () => {
  assert.equal(tagColor("morning"), "var(--tag-morning)");
  assert.equal(tagColor(null), "var(--tag-audition)", "null → défaut");
  assert.equal(tagColor("xyz" as SlotTag), "var(--tag-audition)", "inconnu → défaut");
});
