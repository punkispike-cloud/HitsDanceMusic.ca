/* Tests de la frontière HTTP : composition réelle des middlewares (fakeAuth →
   adminTenant → garde RBAC → handler) sur une mini-app Hono, assertions sur les
   codes HTTP via app.request(). Aucune DB réelle : le cache des radios est injecté
   via setRadioCacheForTests (calque de tenant.test.ts) et le pool est fermé en after.

   NB : on n'utilise PAS le vrai requireAuth (qui vérifie un JWT) afin de rester
   DB/JWT-free : un middleware « fakeAuth » injecte directement un AuthUser fixe
   dans c.set('user'). On teste ainsi la composition adminTenant + gardes RBAC +
   la traduction AppError → HTTP du handler d'erreur réel (onError). */

import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { adminTenant } from "../src/middleware/tenant.ts";
import { requireOwner, requireItOrOwner, requireEditorialAdmin } from "../src/middleware/rbac.ts";
import { AppError } from "../src/lib/errors.ts";
import { setRadioCacheForTests, invalidateRadioCache } from "../src/services/tenant.ts";
import { closeDb } from "../src/db/client.ts";
import type { AppBindings, AuthUser } from "../src/types.ts";

/* Réplique minimale du onError réel (api/src/middleware/error.ts) : traduit
   AppError → son status et fallback → 500. On n'importe PAS le onError réel afin
   d'éviter de tirer @sentry/node (lourd à charger en tests, ~38s sur cette
   suite) ; le mapping AppError → HTTP est strictement identique pour les codes
   exercés ici (400/403/500). Écart documenté : on teste la composition
   adminTenant + gardes + traduction AppError→HTTP, pas la capture Sentry. */
function onError(err: Error, c: Context): Response {
  if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
  return c.json({ error: { code: "internal_error", message: err.message } }, 500);
}

const RADIOS = [
  { id: "radio-a", slug: "alpha", domains: ["alpha.test"], status: "active" },
  { id: "radio-b", slug: "beta", domains: ["beta.test"], status: "active" },
];

const owner: AuthUser = { userId: "o", role: "owner", artistId: null, radioId: null };
const it: AuthUser = { userId: "i", role: "it", artistId: null, radioId: null };
const suA: AuthUser = { userId: "s", role: "superadmin", artistId: null, radioId: "radio-a" };

/** Injecte un AuthUser fixe (ou rien si user=null → simule une requête non auth). */
function fakeAuth(user: AuthUser | null): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (user) c.set("user", user);
    await next();
  };
}

/** Monte la chaîne réelle : fakeAuth → adminTenant → garde → handler JSON. */
function buildApp(opts: {
  user: AuthUser | null;
  guard: MiddlewareHandler<AppBindings>;
  /** false = saute adminTenant (pour isoler le comportement du garde sans user). */
  tenant?: boolean;
}): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  app.onError(onError);
  app.use("*", fakeAuth(opts.user));
  if (opts.tenant !== false) app.use("*", adminTenant);
  app.use("*", opts.guard);
  app.get("*", (c) => c.json({ ok: true, radioId: c.get("radioId") ?? null }));
  return app;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(app: Hono<AppBindings>, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const res = await app.request("/x", { headers });
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

/* ───────────────────── Auth manquant & résolution tenant ───────────────────── */

test("sans user injecté : le garde lève une TypeError → 500 (requireAuth garantit user en amont)", async () => {
  // Comportement RÉEL observé : les gardes accèdent à user.role sans vérifier la
  // présence de user → TypeError capturée par onError → 500 internal_error. Dans
  // l'app réelle, requireAuth court-circuite toujours avant (401 si token
  // manquant/invalide), donc user n'est jamais absent à ce stade. Ce test
  // documente la gap défensive (non corrigée dans cette PR test-only).
  const app = buildApp({ user: null, guard: requireEditorialAdmin, tenant: false });
  const r = await call(app);
  assert.equal(r.status, 500);
  assert.equal(r.body?.error?.code, "internal_error");
  assert.notEqual(r.body?.ok, true, "le handler n'est pas atteint");
});

test("adminTenant : superadmin sans X-Radio-Id n'est PAS rejeté → 200, scopé à sa radio (happy path)", async () => {
  // Vérifie dans tenant.ts : un superadmin (non cross-radio) reçoit user.radioId,
  // jamais de 400. L'hypothèse « superadmin sans X-Radio-Id → 400 » ne correspond
  // pas à l'implémentation (la sélection n'est exigée que pour owner/it).
  const app = buildApp({ user: suA, guard: requireEditorialAdmin });
  const r = await call(app);
  assert.equal(r.status, 200);
  assert.equal(r.body?.ok, true);
  assert.equal(r.body?.radioId, "radio-a");
});

test("adminTenant : owner (cross-radio) avec X-Radio-Id inconnu → 400 unknown_radio", async () => {
  const app = buildApp({ user: owner, guard: requireItOrOwner });
  const r = await call(app, { "X-Radio-Id": "inexistante" });
  assert.equal(r.status, 400);
  assert.equal(r.body?.error?.code, "unknown_radio");
  assert.notEqual(r.body?.ok, true);
});

test("adminTenant : it cible une radio via X-Radio-Id → radioId atteint le handler", async () => {
  const app = buildApp({ user: it, guard: requireItOrOwner });
  const r = await call(app, { "X-Radio-Id": "radio-b" });
  assert.equal(r.status, 200);
  assert.equal(r.body?.radioId, "radio-b");
});

test("adminTenant : owner cible une radio via X-Radio-Id → radioId atteint le handler", async () => {
  const app = buildApp({ user: owner, guard: requireItOrOwner });
  const r = await call(app, { "X-Radio-Id": "radio-b" });
  assert.equal(r.status, 200);
  assert.equal(r.body?.radioId, "radio-b");
});

test("adminTenant : superadmin ne peut PAS forger le X-Radio-Id d'une autre radio (header ignoré)", async () => {
  // Comportement réel : un rôle scopé (superadmin) ignore silencieusement la
  // sélection X-Radio-Id → reste sur sa radio. Pas de rejet (200), mais le
  // radioId forcé n'arrive jamais au handler.
  const app = buildApp({ user: suA, guard: requireEditorialAdmin });
  const r = await call(app, { "X-Radio-Id": "radio-b" });
  assert.equal(r.status, 200);
  assert.equal(r.body?.radioId, "radio-a", "le header X-Radio-Id est ignoré pour un rôle scopé");
});

/* ───────────────────── Gardes RBAC → codes HTTP ───────────────────── */

test("requireEditorialAdmin : it → 403 ; superadmin/owner → 200", async () => {
  const rIt = await call(buildApp({ user: it, guard: requireEditorialAdmin }));
  assert.equal(rIt.status, 403);
  assert.equal(rIt.body?.error?.code, "forbidden");

  const rSu = await call(buildApp({ user: suA, guard: requireEditorialAdmin }));
  assert.equal(rSu.status, 200);
  assert.equal(rSu.body?.radioId, "radio-a");

  const rOwner = await call(buildApp({ user: owner, guard: requireEditorialAdmin }));
  assert.equal(rOwner.status, 200);
  // owner sans X-Radio-Id en multi-radio → radioId null (soleRadioId null).
  assert.equal(rOwner.body?.radioId, null);
});

test("requireItOrOwner : superadmin → 403 ; it/owner → 200", async () => {
  const rSu = await call(buildApp({ user: suA, guard: requireItOrOwner }));
  assert.equal(rSu.status, 403);
  assert.equal(rSu.body?.error?.code, "forbidden");

  const rIt = await call(buildApp({ user: it, guard: requireItOrOwner }));
  assert.equal(rIt.status, 200);

  const rOwner = await call(buildApp({ user: owner, guard: requireItOrOwner }));
  assert.equal(rOwner.status, 200);
});

test("requireOwner : superadmin/it → 403 ; owner → 200", async () => {
  const rSu = await call(buildApp({ user: suA, guard: requireOwner }));
  assert.equal(rSu.status, 403);
  assert.equal(rSu.body?.error?.code, "forbidden");

  const rIt = await call(buildApp({ user: it, guard: requireOwner }));
  assert.equal(rIt.status, 403);
  assert.equal(rIt.body?.error?.code, "forbidden");

  const rOwner = await call(buildApp({ user: owner, guard: requireOwner }));
  assert.equal(rOwner.status, 200);
});
