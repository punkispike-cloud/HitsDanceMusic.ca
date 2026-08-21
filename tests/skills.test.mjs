import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* Une skill au frontmatter invalide n'est pas signalée : elle est ignorée au
   chargement. Sans ce test, on croirait disposer d'un runbook qui ne se
   déclenche jamais. */
test("check:skills — skills projet bien formées", () => {
  const r = spawnSync(process.execPath, ["scripts/check-skills.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
