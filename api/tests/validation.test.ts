/* Tests des schémas/validation : slugify robuste, et les règles Zod qui
   protègent les entrées (email normalisé, mot de passe ≥ 12, etc.). */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slugify,
  emailSchema,
  passwordSchema,
  setPasswordSchema,
  forgotPasswordSchema,
  registerSchema,
  roleSchema,
  slotTagSchema,
} from "../src/lib/validation.ts";

test("slugify : accents retirés, espaces/symboles → tirets, bornes propres", () => {
  assert.equal(slugify("DJ OSKANA Show"), "dj-oskana-show");
  assert.equal(slugify("Hommage au Limelight Montréal"), "hommage-au-limelight-montreal");
  assert.equal(slugify("  Été 2026 !!! "), "ete-2026");
  assert.equal(slugify("a---b___c"), "a-b-c");
  assert.equal(slugify("ÀÉÎÔÛ"), "aeiou");
});

test("slugify : borné à 80 caractères", () => {
  assert.ok(slugify("x".repeat(200)).length <= 80);
});

test("emailSchema : normalise (trim + minuscules), rejette l'invalide", () => {
  assert.equal(emailSchema.parse("  Admin@HitsDanceMusic.CA "), "admin@hitsdancemusic.ca");
  assert.throws(() => emailSchema.parse("pas-un-email"));
  assert.throws(() => emailSchema.parse(""));
});

test("passwordSchema : refuse < 12 caractères", () => {
  assert.throws(() => passwordSchema.parse("court"));
  assert.throws(() => passwordSchema.parse("onze_caract"));
  assert.doesNotThrow(() => passwordSchema.parse("douze_caracts")); // 13
  assert.doesNotThrow(() => passwordSchema.parse("a".repeat(12)));
});

test("setPasswordSchema : token + mot de passe valides requis", () => {
  assert.doesNotThrow(() => setPasswordSchema.parse({ token: "a".repeat(20), password: "motdepasse123" }));
  assert.throws(() => setPasswordSchema.parse({ token: "court", password: "motdepasse123" }));
  assert.throws(() => setPasswordSchema.parse({ token: "a".repeat(20), password: "court" }));
});

test("forgotPasswordSchema : email normalisé", () => {
  assert.equal(forgotPasswordSchema.parse({ email: "X@Y.CA" }).email, "x@y.ca");
});

test("registerSchema : rôle par défaut = lecteur", () => {
  const parsed = registerSchema.parse({
    email: "a@b.ca",
    password: "motdepasse123",
    displayName: "Test",
  });
  assert.equal(parsed.role, "lecteur");
});

test("registerSchema : artistId doit être un uuid si fourni", () => {
  assert.throws(() =>
    registerSchema.parse({ email: "a@b.ca", password: "motdepasse123", displayName: "T", artistId: "pas-uuid" }),
  );
});

test("slotTagSchema : n'accepte que les tags connus", () => {
  for (const t of ["morning", "hitlist", "drive", "limelight", "night", "special", "audition"]) {
    assert.doesNotThrow(() => slotTagSchema.parse(t));
  }
  assert.throws(() => slotTagSchema.parse("inexistant"));
});

test("roleSchema : accepte owner/superadmin/animateur/lecteur, rejette le reste", () => {
  for (const r of ["owner", "superadmin", "animateur", "lecteur"]) {
    assert.doesNotThrow(() => roleSchema.parse(r));
  }
  assert.throws(() => roleSchema.parse("root"));
});
