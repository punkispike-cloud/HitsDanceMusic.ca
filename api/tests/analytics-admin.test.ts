/* Tests HTTP de la frontière RBAC des routes analytics admin qui exposent des
   données personnelles (IP des visiteurs) : /sessions et /export.

   Ce qu'on protège (audit + Phase 2.3) : ces deux routes sont réservées à
   superadmin + owner. Le rôle `it` (technique cross-radio) est EXCLU — il a
   accès au monitoring du parc mais PAS aux IP des visiteurs. Les rôles
   animateur/lecteur le sont aussi.

   DB-free : on compose fakeAuth -> adminTenant (reel) -> analyticsAdminRoutes
   (reel). Sous NODE_ENV=test, adminTenant ne pose pas de client request-scoped
   (requestDbEnabled()=false) -> aucun appel DB. La garde requireRole s'exécute
   AVANT le handler : un rôle non autorisé reçoit 403 sans toucher la DB. Pour
   superadmin/owner, la garde passe et le handler atteint la DB (qui échoue en
   test -> 500) ; on asserte juste que ce n'est PAS 403 (la garde laisse passer). */

import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { adminTenant } from "../src/middleware/tenant.ts";
import { analyticsAdminRoutes } from "../src/routes/analytics-admin.ts";
import { AppError } from "../src/lib/errors.ts";
import { setRadioCacheForTests, invalidateRadioCache } from "../src/services/tenant.ts";
import { closeDb } from "../src/db/client.ts";
import type { AppBindings, AuthUser } from "../src/types.ts";

/* Réplique du onError réel (api/src/middleware/error.ts) : traduit AppError ->
   son status. On n'importe PAS le onError réel afin d'éviter de tirer
   @sentry/node (lourd en tests) ; le mapping est strictement identique pour
   les codes exercés ici (403). */
function onError(err: Error, c: Context): Response {
  if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
  return c.json({ error: { code: "internal_error", message: err.message } }, 500);
}

const RADIOS = [
  { id: "radio-a", slug: "alpha", domains: ["alpha.test"], status: "active" },
  { id: "radio-b", slug: "beta", domains: ["beta.test"], status: "active" },
];

const suA: AuthUser = { userId: "s", role: "superadmin", artistId: null, radioId: "radio-a" };
const owner: AuthUser = { userId: "o", role: "owner", artistId: null, radioId: null };
const it: AuthUser = { userId: "i", role: "it", artistId: null, radioId: null };
const anim: AuthUser = { userId: "an", role: "animateur", artistId: null, radioId: "radio-a" };
const lecteur: AuthUser = { userId: "l", role: "lecteur", artistId: null, radioId: "radio-a" };

function fakeAuth(user: AuthUser): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    c.set("user", user);
    await next();
  };
}

function buildApp(user: AuthUser): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  app.onError(onError);
  app.use("*", fakeAuth(user));
  app.use("*", adminTenant);
  app.route("/v1/admin/analytics", analyticsAdminRoutes);
  return app;
}

async function call(
  app: Hono<AppBindings>,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await app.request(path, { headers });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* corps non-JSON */
  }
  return { status: res.status, body };
}

beforeEach(() => setRadioCacheForTests(RADIOS));
afterEach(() => invalidateRadioCache());
after(async () => {
  await closeDb();
});

/* ───────────────── /sessions : IP exposées -> superadmin + owner seulement ───────────────── */

test("/sessions : it (technique cross-radio) -> 403 (IP exclues)", async () => {
  const r = await call(buildApp(it), "/v1/admin/analytics/sessions");
  assert.equal(r.status, 403);
  assert.equal((r.body as { error?: { code?: string } })?.error?.code, "forbidden");
});

test("/sessions : animateur -> 403", async () => {
  const r = await call(buildApp(anim), "/v1/admin/analytics/sessions");
  assert.equal(r.status, 403);
});

test("/sessions : lecteur -> 403", async () => {
  const r = await call(buildApp(lecteur), "/v1/admin/analytics/sessions");
  assert.equal(r.status, 403);
});

test("/sessions : superadmin -> la garde laisse passer (pas 403)", async () => {
  // superadmin est scopé à sa radio (radio-a) par adminTenant. La garde passe ;
  // le handler atteint la DB, indisponible en test -> 500. L'assertion clé : ce
  // n'est PAS 403 (la route ne le bloque pas).
  const r = await call(buildApp(suA), "/v1/admin/analytics/sessions");
  assert.notEqual(r.status, 403, "superadmin doit passer la garde RBAC");
});

test("/sessions : owner avec X-Radio-Id -> la garde laisse passer (pas 403)", async () => {
  const r = await call(buildApp(owner), "/v1/admin/analytics/sessions", { "X-Radio-Id": "radio-a" });
  assert.notEqual(r.status, 403, "owner doit passer la garde RBAC");
});

/* ───────────────── /export : CSV (IP) -> superadmin + owner seulement ───────────────── */

test("/export : it -> 403 (CSV sessions expose les IP)", async () => {
  const r = await call(buildApp(it), "/v1/admin/analytics/export?type=sessions");
  assert.equal(r.status, 403);
  assert.equal((r.body as { error?: { code?: string } })?.error?.code, "forbidden");
});

test("/export : animateur -> 403 ; lecteur -> 403", async () => {
  const rAnim = await call(buildApp(anim), "/v1/admin/analytics/export");
  assert.equal(rAnim.status, 403);
  const rLecteur = await call(buildApp(lecteur), "/v1/admin/analytics/export");
  assert.equal(rLecteur.status, 403);
});

test("/export : superadmin -> la garde laisse passer (pas 403)", async () => {
  const r = await call(buildApp(suA), "/v1/admin/analytics/export?type=shows");
  assert.notEqual(r.status, 403, "superadmin doit passer la garde RBAC (même export shows)");
});
