/* Tests : parseTrackString — parse les chaînes now-playing des relays.
   Run : node --test tests/parsing.test.mjs */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrackString } from "../js/now-playing.js";

test("retourne null pour une chaîne vide", () => {
  assert.equal(parseTrackString(""), null);
  assert.equal(parseTrackString(null), null);
  assert.equal(parseTrackString("   "), null);
});

test("format Artiste - Titre", () => {
  assert.deepEqual(
    parseTrackString("Daft Punk - One More Time"),
    { artist: "Daft Punk", title: "One More Time" }
  );
});

test("format CentovaCast : Stream Name - Artist - Title", () => {
  assert.deepEqual(
    parseTrackString("Hits Dance Music Stream - David Guetta - Titanium"),
    { artist: "David Guetta", title: "Titanium" }
  );
});

test("variante prefix sans 's' (Hit Dance Music Stream)", () => {
  assert.deepEqual(
    parseTrackString("Hit Dance Music Stream - Calvin Harris - Summer"),
    { artist: "Calvin Harris", title: "Summer" }
  );
});

test("séparateurs '?' (encodage défaillant) convertis en ' - '", () => {
  assert.deepEqual(
    parseTrackString("Bob Sinclar ? World Hold On"),
    { artist: "Bob Sinclar", title: "World Hold On" }
  );
});

test("titre seul + knownArtist fournis séparément", () => {
  assert.deepEqual(
    parseTrackString("Levels", "Avicii"),
    { artist: "Avicii", title: "Levels" }
  );
});

test("titre seul sans knownArtist → artist vide", () => {
  assert.deepEqual(
    parseTrackString("Unknown Track"),
    { artist: "", title: "Unknown Track" }
  );
});

test("trim correct des espaces", () => {
  assert.deepEqual(
    parseTrackString("  Martin Garrix - Animals  "),
    { artist: "Martin Garrix", title: "Animals" }
  );
});

test("séparateur em-dash après le prefix Stream", () => {
  assert.deepEqual(
    parseTrackString("Hits Dance Music Stream — Tiesto - Adagio for Strings"),
    { artist: "Tiesto", title: "Adagio for Strings" }
  );
});

test("titre contenant un tiret (premier ' - ' wins)", () => {
  assert.deepEqual(
    parseTrackString("Avicii - Wake Me Up - Radio Edit"),
    { artist: "Avicii", title: "Wake Me Up - Radio Edit" }
  );
});
