import { test } from "node:test";
import assert from "node:assert/strict";
import { dbipLiteUrl } from "../src/lib/geo-db.ts";

test("dbipLiteUrl utilise YYYY-MM UTC", () => {
  const url = dbipLiteUrl(new Date("2026-08-17T12:00:00Z"));
  assert.equal(url, "https://download.db-ip.com/free/dbip-city-lite-2026-08.mmdb.gz");
});
