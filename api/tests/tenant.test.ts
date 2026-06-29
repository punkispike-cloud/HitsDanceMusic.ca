/* Tests d'isolement tenant (C1.1).
   On valide le branchement des middlewares publicTenant / adminTenant :
   - owner + it = cross-radio (sélectionnent la radio via X-Radio-Id / ?radio,
     ou retombent sur l'unique radio du parc) ;
   - superadmin / animateur / lecteur = scopés à user.radioId (ignorent la sélection).
   Aucune DB réelle : on injecte le cache des radios via setRadioCacheForTests
   (les middlewares servent ce cache sans requêter). Calque des tests rbac.test.ts. */

import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { publicTenant, adminTenant } from "../src/middleware/tenant.ts";
import { setRadioCacheForTests, invalidateRadioCache } from "../src/services/tenant.ts";
import { closeDb } from "../src/db/client.ts";
import { AppError } from "../src/lib/errors.ts";
import type { AuthUser } from "../src/types.ts";

const RADIOS = [
  { id: "radio-a", slug: "alpha", domains: ["alpha.test", "www.alpha.test"], status: "active" },
  { id: "radio-b", slug: "beta", domains: ["beta.test"], status: "active" },
];

const owner: AuthUser = { userId: "o", role: "owner", artistId: null, radioId: null };
const it: AuthUser = { userId: "i", role: "it", artistId: null, radioId: null };
const suA: AuthUser = { userId: "s", role: "superadmin", artistId: null, radioId: "radio-a" };
const suNull: AuthUser = { userId: "s2", role: "superadmin", artistId: null, radioId: null };
const dj: AuthUser = { userId: "d", role: "animateur", artistId: "artist-1", radioId: "radio-a" };
const reader: AuthUser = { userId: "r", role: "lecteur", artistId: null, radioId: "radio-a" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeCtx(user: AuthUser | undefined, headers: Record<string, string> = {}, query: Record<string, string> = {}): any {
  const vars: Record<string, unknown> = {};
  const h: Record<string, string> = {};
  for (const k of Object.keys(headers)) h[k.toLowerCase()] = headers[k];
  return {
    vars,
    get: (k: string) => (k === "user" ? user : vars[k]),
    set: (k: string, v: unknown) => {
      vars[k] = v;
    },
    req: { header: (name: string) => h[name.toLowerCase()], query: (q: string) => query[q] },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(mw: any, ctx: any) {
  let nextCalled = false;
  const next = async () => {
    nextCalled = true;
  };
  let error: unknown = null;
  try {
    await mw(ctx, next);
  } catch (e) {
    error = e;
  }
  return { radioId: ctx.vars.radioId as string | null | undefined, nextCalled, error };
}

beforeEach(() => setRadioCacheForTests(RADIOS));
afterEach(() => invalidateRadioCache());
after(async () => {
  await closeDb();
});

/* ───────────────────────── publicTenant (hôte HTTP) ───────────────────────── */

test("publicTenant : multi-radio, hôte alpha → radio-a", async () => {
  const r = await run(publicTenant, fakeCtx(undefined, { host: "alpha.test" }));
  assert.equal(r.radioId, "radio-a");
  assert.equal(r.nextCalled, true);
});

test("publicTenant : multi-radio, hôte beta → radio-b", async () => {
  const r = await run(publicTenant, fakeCtx(undefined, { host: "beta.test" }));
  assert.equal(r.radioId, "radio-b");
});

test("publicTenant : multi-radio, hôte inconnu → null (résolu plus tard par requireRadioId)", async () => {
  const r = await run(publicTenant, fakeCtx(undefined, { host: "unknown.test" }));
  assert.equal(r.radioId, null);
});

test("publicTenant : multi-radio, sans hôte → null", async () => {
  const r = await run(publicTenant, fakeCtx(undefined, {}));
  assert.equal(r.radioId, null);
});

test("publicTenant : mono-radio, n'importe quel hôte → l'unique radio", async () => {
  setRadioCacheForTests([RADIOS[0]!]);
  const r = await run(publicTenant, fakeCtx(undefined, { host: "nimporte.test" }));
  assert.equal(r.radioId, "radio-a");
});

test("publicTenant : strip le port + www. lors du matching", async () => {
  const r = await run(publicTenant, fakeCtx(undefined, { host: "WWW.alpha.test:443" }));
  assert.equal(r.radioId, "radio-a");
});

/* ───────────────────────── adminTenant (rôles scopés) ───────────────────────── */

test("adminTenant : superadmin scopé à sa radio (ignore soleRadioId en multi)", async () => {
  const r = await run(adminTenant, fakeCtx(suA));
  assert.equal(r.radioId, "radio-a");
  assert.equal(r.nextCalled, true);
});

test("adminTenant : superadmin sans radioId retombe sur soleRadioId (mono)", async () => {
  setRadioCacheForTests([RADIOS[0]!]);
  const r = await run(adminTenant, fakeCtx(suNull));
  assert.equal(r.radioId, "radio-a");
});

test("adminTenant : animateur scopé à sa radio", async () => {
  const r = await run(adminTenant, fakeCtx(dj));
  assert.equal(r.radioId, "radio-a");
});

test("adminTenant : lecteur scopé à sa radio", async () => {
  const r = await run(adminTenant, fakeCtx(reader));
  assert.equal(r.radioId, "radio-a");
});

test("adminTenant : un rôle scopé IGNORE la sélection X-Radio-Id (anti-contournement)", async () => {
  const r = await run(adminTenant, fakeCtx(suA, { "X-Radio-Id": "radio-b" }));
  assert.equal(r.radioId, "radio-a", "un superadmin ne peut pas cibler une autre radio via le header");
});

/* ───────────────────────── adminTenant (rôles cross-radio) ───────────────────────── */

test("adminTenant : owner sans sélection en multi → null (soleRadioId null)", async () => {
  const r = await run(adminTenant, fakeCtx(owner));
  assert.equal(r.radioId, null);
});

test("adminTenant : owner sans sélection en mono → l'unique radio", async () => {
  setRadioCacheForTests([RADIOS[0]!]);
  const r = await run(adminTenant, fakeCtx(owner));
  assert.equal(r.radioId, "radio-a");
});

test("adminTenant : owner sélectionne via X-Radio-Id", async () => {
  const r = await run(adminTenant, fakeCtx(owner, { "X-Radio-Id": "radio-b" }));
  assert.equal(r.radioId, "radio-b");
});

test("adminTenant : owner sélectionne via ?radio=", async () => {
  const ctx = fakeCtx(owner, {}, { radio: "radio-b" });
  const r = await run(adminTenant, ctx);
  assert.equal(r.radioId, "radio-b");
});

test("adminTenant : owner sélectionne une radio inconnue → 400 unknown_radio", async () => {
  const r = await run(adminTenant, fakeCtx(owner, { "X-Radio-Id": "inexistante" }));
  assert.equal(r.nextCalled, false);
  assert.ok(r.error instanceof AppError);
  assert.equal((r.error as AppError).status, 400);
  assert.equal((r.error as AppError).code, "unknown_radio");
});

test("adminTenant : it est cross-radio (sélection via X-Radio-Id)", async () => {
  const r = await run(adminTenant, fakeCtx(it, { "X-Radio-Id": "radio-b" }));
  assert.equal(r.radioId, "radio-b");
});

test("adminTenant : it sans sélection en multi → null", async () => {
  const r = await run(adminTenant, fakeCtx(it));
  assert.equal(r.radioId, null);
});

test("adminTenant : owner en mono avec X-Radio-Id de la seule radio → cette radio", async () => {
  setRadioCacheForTests([RADIOS[0]!]);
  const r = await run(adminTenant, fakeCtx(owner, { "X-Radio-Id": "radio-a" }));
  assert.equal(r.radioId, "radio-a");
});
