/* A5 : sans GEOIP_DB_PATH, resolveGeo ne fait aucun appel réseau et renvoie null. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGeo } from "../src/services/geoip.ts";

test("resolveGeo : IP vide → null", async () => {
  assert.equal(await resolveGeo(""), null);
});

test("resolveGeo : sans GEOIP_DB_PATH → null (pas de fuite tiers)", async () => {
  assert.equal(await resolveGeo("8.8.8.8"), null);
});
