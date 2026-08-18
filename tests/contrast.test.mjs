import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("check:contrast — tokens WCAG 2.2 AA", () => {
  const r = spawnSync(process.execPath, ["scripts/check-contrast.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
