#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

const railwayJs = [
  "C:/nvm4w/nodejs/node_modules/@railway/cli/bin/railway.js",
  join(homedir(), "AppData/Roaming/npm/node_modules/@railway/cli/bin/railway.js"),
].find((p) => existsSync(p));

function rw(args) {
  return spawnSync(process.execPath, [railwayJs, ...args], {
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

function setVar(service, key, value) {
  const r = spawnSync(
    process.execPath,
    [railwayJs, "variable", "set", "--service", service, "--stdin", key],
    { encoding: "utf8", input: value, timeout: 60_000 },
  );
  if (r.status !== 0) {
    console.error(key, r.stderr || r.stdout);
    process.exit(1);
  }
}

rw(["environment", "link", "production"]);

const pwd = randomBytes(32).toString("base64url");
const list = rw(["variable", "list", "--service", "Postgres", "--json"]);
const pg = JSON.parse(list.stdout);
const u = new URL(pg.DATABASE_URL);
u.password = pwd;
const newUrl = u.toString();
console.log("[1] rotate password host=", u.hostname);

// IMPORTANT: use String.raw or doubled backslashes — "\tmp" is TAB+mp in JS strings!
const alterScript = [
  "#!/bin/sh",
  "set -e",
  "export PAGER=cat PGHOST=/var/run/postgresql",
  "psql -U postgres -d railway -P pager=off -v ON_ERROR_STOP=1 -c \"ALTER USER postgres WITH PASSWORD '" + pwd + "';\"",
  "echo ALTER_OK",
  "psql -U postgres -d railway -P pager=off -tAc \"SELECT 'RADIOS='||count(*) FROM radios\"",
  "echo DONE",
].join("\n");

const b64 = Buffer.from(alterScript).toString("base64");
const chunks = [];
for (let i = 0; i < b64.length; i += 180) chunks.push(b64.slice(i, i + 180));

const remoteCmd = [
  "rm -f /var/tmp/fixpg.b64 /var/tmp/fixpg.sh",
  ...chunks.map((c) => "echo -n '" + c + "' >> /var/tmp/fixpg.b64"),
  "base64 -d /var/tmp/fixpg.b64 > /var/tmp/fixpg.sh",
  "sh /var/tmp/fixpg.sh",
].join("; ");

console.log("[2] ALTER via unix socket");
const ssh = rw(["ssh", "-s", "Postgres", "--", "sh", "-c", remoteCmd]);
console.log(ssh.stdout);
if (ssh.stderr) console.error(ssh.stderr);
if (!(ssh.stdout || "").includes("ALTER_OK") || !(ssh.stdout || "").includes("DONE")) {
  process.exit(1);
}

console.log("[3] sync Railway vars");
setVar("Postgres", "PGPASSWORD", pwd);
setVar("Postgres", "POSTGRES_PASSWORD", pwd);
setVar("Postgres", "DATABASE_URL", newUrl);
setVar("patient-endurance", "DATABASE_URL", newUrl);
setVar("patient-endurance", "MIGRATE_DATABASE_URL", newUrl);
console.log("  vars synced");

console.log("[4] redeploy API");
rw(["redeploy", "--service", "patient-endurance", "--yes"]);

console.log("[5] poll deploy status");
for (let i = 0; i < 48; i++) {
  sleep(5000);
  const deps = JSON.parse(rw(["deployment", "list", "--service", "patient-endurance", "--json"]).stdout);
  const latest = deps[0];
  const age = Date.now() - new Date(latest.createdAt).getTime();
  console.log("  [" + i + "] " + latest.status + " " + Math.round(age / 1000) + "s");
  if (latest.status === "SUCCESS") {
    console.log("SUCCESS " + latest.id);
    process.exit(0);
  }
  if (latest.status === "FAILED" && age > 150000) {
    const logs = rw(["logs", "--service", "patient-endurance", "--deployment", latest.id]);
    console.error((logs.stdout || "").slice(-3000));
    process.exit(1);
  }
}
process.exit(1);
