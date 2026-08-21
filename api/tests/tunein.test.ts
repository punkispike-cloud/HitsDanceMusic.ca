/* Distribution TuneIn — API AIR.
   On teste ce qui est testable sans réseau ni base : la construction de l'URL
   (encodage des caractères qui cassent une query string) et le filtre qui
   empêche un jingle de partir chez TuneIn. */

import test from "node:test";
import assert from "node:assert/strict";
import { buildAirUrl } from "../src/services/tunein.js";

test("buildAirUrl : les 5 paramètres exigés par TuneIn sont présents", () => {
  const url = new URL(buildAirUrl("s123456", "Daft Punk", "One More Time", "PID", "PKEY"));
  assert.equal(url.origin + url.pathname, "https://air.radiotime.com/Playing.ashx");
  assert.equal(url.searchParams.get("partnerId"), "PID");
  assert.equal(url.searchParams.get("partnerKey"), "PKEY");
  assert.equal(url.searchParams.get("id"), "s123456");
  assert.equal(url.searchParams.get("artist"), "Daft Punk");
  assert.equal(url.searchParams.get("title"), "One More Time");
});

test("buildAirUrl : encode les caractères qui casseraient la query string", () => {
  // Une esperluette ou un signe = non encodés couperaient le titre en deux
  // paramètres, et TuneIn afficherait un titre tronqué.
  const url = new URL(buildAirUrl("s1", "AC/DC & Friends", "Rock=Roll ?", "p", "k"));
  assert.equal(url.searchParams.get("artist"), "AC/DC & Friends");
  assert.equal(url.searchParams.get("title"), "Rock=Roll ?");
});

test("buildAirUrl : accents et apostrophes survivent au transport", () => {
  const url = new URL(buildAirUrl("s1", "Céline Dion", "S'il suffisait d'aimer", "p", "k"));
  assert.equal(url.searchParams.get("artist"), "Céline Dion");
  assert.equal(url.searchParams.get("title"), "S'il suffisait d'aimer");
});

test("buildAirUrl : artiste vide reste envoyé (efface l'artiste précédent)", () => {
  // Sans le paramètre, TuneIn garderait l'artiste du morceau d'avant collé au
  // nouveau titre. Le paramètre doit donc exister, même vide.
  const url = new URL(buildAirUrl("s1", "", "Instrumental", "p", "k"));
  assert.ok(url.searchParams.has("artist"));
  assert.equal(url.searchParams.get("artist"), "");
});
