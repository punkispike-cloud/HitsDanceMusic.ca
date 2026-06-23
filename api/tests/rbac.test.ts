/* Tests des gardes RBAC. On simule un contexte Hono minimal (get('user'),
   req.param('id')) et on vérifie le comportement attendu : qui passe, qui est
   bloqué (403/404), et que `next` n'est appelé QUE si l'accès est accordé. */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  requireRole,
  requireMinRole,
  requireOwner,
  requireOwnershipOrAdmin,
  assertCanActAs,
  assertCanAssignRole,
  assertCanManageUser,
} from "../src/middleware/rbac.ts";
import { AppError } from "../src/lib/errors.ts";
import type { AuthUser } from "../src/types.ts";

const owner: AuthUser = { userId: "o", role: "owner", artistId: null };
const su: AuthUser = { userId: "s", role: "superadmin", artistId: null };
const dj: AuthUser = { userId: "d", role: "animateur", artistId: "artist-1" };
const reader: AuthUser = { userId: "r", role: "lecteur", artistId: null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeCtx(user: AuthUser, params: Record<string, string> = {}): any {
  return { get: (k: string) => (k === "user" ? user : undefined), req: { param: (p: string) => params[p] } };
}

/** Exécute un middleware et rapporte si next() a été appelé / l'erreur levée. */
async function run(mw: ReturnType<typeof requireRole>, ctx: unknown) {
  let nextCalled = false;
  const next = async () => { nextCalled = true; };
  let error: unknown = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  try { await mw(ctx as any, next as any); } catch (e) { error = e; }
  return { nextCalled, error };
}

test("requireRole : rôle autorisé passe, sinon 403", async () => {
  let res = await run(requireRole("superadmin"), fakeCtx(su));
  assert.equal(res.nextCalled, true);
  assert.equal(res.error, null);

  res = await run(requireRole("superadmin"), fakeCtx(dj));
  assert.equal(res.nextCalled, false);
  assert.ok(res.error instanceof AppError);
  assert.equal((res.error as AppError).status, 403);
});

test("requireRole : liste multiple", async () => {
  const mw = requireRole("superadmin", "animateur");
  assert.equal((await run(mw, fakeCtx(dj))).nextCalled, true);
  assert.equal((await run(mw, fakeCtx(reader))).nextCalled, false);
});

test("requireMinRole : hiérarchie lecteur < animateur < superadmin", async () => {
  const needAnimateur = requireMinRole("animateur");
  assert.equal((await run(needAnimateur, fakeCtx(su))).nextCalled, true);
  assert.equal((await run(needAnimateur, fakeCtx(dj))).nextCalled, true);
  assert.equal((await run(needAnimateur, fakeCtx(reader))).nextCalled, false);
});

test("requireOwnershipOrAdmin : superadmin passe sans charger la ressource", async () => {
  let loaderCalled = false;
  const loader = async () => { loaderCalled = true; return { artistId: "autre" }; };
  const res = await run(requireOwnershipOrAdmin(loader), fakeCtx(su, { id: "x" }));
  assert.equal(res.nextCalled, true);
  assert.equal(loaderCalled, false, "le superadmin court-circuite le loader");
});

test("requireOwnershipOrAdmin : propriétaire passe, autre → 403", async () => {
  const ownLoader = async () => ({ artistId: "artist-1" }); // appartient à dj
  let res = await run(requireOwnershipOrAdmin(ownLoader), fakeCtx(dj, { id: "x" }));
  assert.equal(res.nextCalled, true);

  const otherLoader = async () => ({ artistId: "artist-99" }); // appartient à un autre
  res = await run(requireOwnershipOrAdmin(otherLoader), fakeCtx(dj, { id: "x" }));
  assert.equal(res.nextCalled, false);
  assert.equal((res.error as AppError).status, 403);
});

test("requireOwnershipOrAdmin : ressource absente → 404", async () => {
  const noLoader = async () => undefined;
  const res = await run(requireOwnershipOrAdmin(noLoader), fakeCtx(dj, { id: "x" }));
  assert.equal(res.nextCalled, false);
  assert.equal((res.error as AppError).status, 404);
});

test("assertCanActAs : superadmin OK partout ; animateur seulement sur le sien", () => {
  assert.doesNotThrow(() => assertCanActAs(su, "n-importe"));
  assert.doesNotThrow(() => assertCanActAs(dj, "artist-1"));
  assert.throws(() => assertCanActAs(dj, "artist-2"), (e) => e instanceof AppError && e.status === 403);
  assert.throws(() => assertCanActAs(reader, null), (e) => e instanceof AppError && e.status === 403);
});

/* ───────────────────────── Tier OWNER (En Ondes) ───────────────────────── */

test("owner : court-circuite l'ownership (comme un admin, en plus haut)", async () => {
  let loaderCalled = false;
  const loader = async () => { loaderCalled = true; return { artistId: "autre" }; };
  const res = await run(requireOwnershipOrAdmin(loader), fakeCtx(owner, { id: "x" }));
  assert.equal(res.nextCalled, true);
  assert.equal(loaderCalled, false, "l'owner court-circuite le loader");
  assert.doesNotThrow(() => assertCanActAs(owner, "n-importe-quoi"));
});

test("requireMinRole('superadmin') : owner ET superadmin passent, animateur bloqué", async () => {
  const needAdmin = requireMinRole("superadmin");
  assert.equal((await run(needAdmin, fakeCtx(owner))).nextCalled, true);
  assert.equal((await run(needAdmin, fakeCtx(su))).nextCalled, true);
  assert.equal((await run(needAdmin, fakeCtx(dj))).nextCalled, false);
});

test("requireOwner : seul l'owner passe (superadmin → 403)", async () => {
  assert.equal((await run(requireOwner, fakeCtx(owner))).nextCalled, true);
  const res = await run(requireOwner, fakeCtx(su));
  assert.equal(res.nextCalled, false);
  assert.equal((res.error as AppError).status, 403);
});

test("assertCanAssignRole : un superadmin ne peut PAS attribuer owner", () => {
  assert.throws(() => assertCanAssignRole(su, "owner"), (e) => e instanceof AppError && e.status === 403);
  assert.doesNotThrow(() => assertCanAssignRole(su, "superadmin"));
  assert.doesNotThrow(() => assertCanAssignRole(owner, "owner"));
});

test("assertCanManageUser : un superadmin ne peut PAS gérer un owner", () => {
  assert.throws(() => assertCanManageUser(su, "owner"), (e) => e instanceof AppError && e.status === 403);
  assert.doesNotThrow(() => assertCanManageUser(su, "superadmin"));
  assert.doesNotThrow(() => assertCanManageUser(owner, "superadmin"));
});
