#!/usr/bin/env node
/* Vérifie que nginx.conf bloque les fichiers d'infra (plan production Vague 1.2). */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const conf = readFileSync(join(root, "nginx.conf"), "utf8");

const required = [
  /nginx\\.conf/,
  /Dockerfile/,
  /package\\.json/,
  /location\s+~\s+\^\/brand\//,
];

let ok = true;
for (const re of required) {
  if (!re.test(conf)) {
    console.error(`[check-nginx-deny] ✗ motif manquant : ${re}`);
    ok = false;
  }
}
if (!ok) process.exit(1);
console.log("[check-nginx-deny] ✓ deny infra présents dans nginx.conf");
