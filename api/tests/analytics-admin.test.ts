/* Frontiere HTTP des routes analytics admin : composition reelle des middlewares
   (fakeAuth -> adminTenant -> garde RBAC du routeur -> handler) sur la VRAIE instance
   analyticsAdminRoutes. Aucune DB reelle : cache radios injecte via
   setRadioCacheForTests (calque de http-rbac.test.ts) ; chaque cas se termine avant
   tout acces DB (403 garde, ou 404 requireRadioId(null) sur parc multi-radio sans
   X-Radio-Id).

   Ce qu'on protege :
   - /sessions et /export (exposent des IP) restreints a superadmin + owner ; le
     role `it` (technique cross-radio) est EXCLU -> 403.
   - /overview, /shows, /top-tracks, /timeseries, /geo, /breakdown (agregats sans
     IP) n'ont PAS de garde RBAC propre : tout admin authentifie y accede (l'auth
     est enforced au montage /v1/admin/* dans index.ts, pas dans le routeur).
   - Le filtrage radio_id est couvert statiquement par `npm run tenant:guard`
     (RLS_STRICT=1) en CI ; la propriete dynamique par analytics-ingest.test.ts. */

import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { adminTenant } from "../src/middleware/tenant.ts";
import { AppError } from "../src/lib/errors.ts";
import { analyticsAdminRoutes } from "../src/routes/analytics-admin.ts";
import { setRadioCacheForTests, invalidateRadioCache } from "../src/services/tenant.ts";
import { closeDb } from "../src/db/client.ts";
import type { AppBindings, AuthUser } from "../src/types.ts";

function onError(err: Error, c: Context): Response {
  if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
  return c.json({ error: { code: "internal_error", message: err.message } }, 500);
}

// Parc multi-radio (2 radios) -> soleRadioId() renvoie null sans X-Radio-Id.
const RADIOS = [
  { id: "radio-a", slug: "alpha", domains: ["alpha.test"], status: "active" },
  { id: "radio-b", slug: "beta", domains: ["beta.test"], status: "active" },
];

const owner: AuthUser = { userId: "o", role: "owner", artistId: null, radioId: null };
const it: AuthUser = { userId: "i", role: "it", artistId: null, radioId: null };

function fakeAuth(user: AuthUser | null): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (user) c.set("user", user);
    await next();
  };
}

function buildApp(user: AuthUser | null, opts: { tenant?: boolean } = {}): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  app.onError(onError);
  app.use("*", fakeAuth(user));
  if (opts.tenant !== false) app.use("*", adminTenant);
  app.route("/", analyticsAdminRoutes);
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

/* ───────── /sessions + /export : exclusion de `it` ───────── */

test("/sessions : it -> 403 (exposant des IP, role technique exclu)", async () => {
  const r = await call(buildApp(it), "/sessions");
  assert.equal(r.status, 403);
  assert.equal((r.body as { error?: { code?: string } })?.error?.code, "forbidden");
});

test("/export : it -> 403 (CSV sessions expose les IP)", async () => {
  const r = await call(buildApp(it), "/export?type=sessions");
  assert.equal(r.status, 403);
  assert.equal((r.body as { error?: { code?: string } })?.error?.code, "forbidden");
});

test("/export?type=shows : it -> 403 aussi (garde sur la route, pas sur le type)", async () => {
  const r = await call(buildApp(it), "/export?type=shows");
  assert.equal(r.status, 403);
});

/* ───────── /sessions + /export : owner autorise (garde laisse passer) ───────── */

test("/sessions : owner sans X-Radio-Id -> 404 (garde passée, puis radio null)", async () => {
  // 404 = requireRadioId(null) dans le handler : preuve que la garde RBAC a laissé
  // passer owner (sinon 403). Aucune DB atteinte (le 404 survient avant).
  const r = await call(buildApp(owner), "/sessions");
  assert.equal(r.status, 404);
  assert.notEqual((r.body as { error?: { code?: string } })?.error?.code, "forbidden");
});

test("/export : owner sans X-Radio-Id -> 404 (garde passée)", async () => {
  const r = await call(buildApp(owner), "/export");
  assert.equal(r.status, 404);
  assert.notEqual((r.body as { error?: { code?: string } })?.error?.code, "forbidden");
});

/* ───────── routes agrégées : pas de garde RBAC propre (tout admin y accède) ───────── */

const AGGREGATE_ROUTES = ["/overview", "/shows", "/top-tracks", "/timeseries", "/geo", "/breakdown"];

for (const path of AGGREGATE_ROUTES) {
  test(`${path} : it -> 404 (pas de garde RBAC, atteint le handler puis radio null)`, async () => {
    const r = await call(buildApp(it), path);
    assert.equal(r.status, 404, "pas de garde RBAC -> le handler tourne puis requireRadioId(null)");
    assert.notEqual((r.body as { error?: { code?: string } })?.error?.code, "forbidden");
  });
}

/* ───────── auth manquant : garde défensive ───────── */

test("/sessions : sans user -> 401 (garde requireRole défensive)", async () => {
  // En prod, requireAuth (index.ts) court-circuite avant adminTenant et pose user.
  // Ici on saute adminTenant (tenant:false) pour isoler la garde défensive de
  // requireRole, qui renvoie 401 si aucun user n'est présent (anti-misconfiguration).
  const r = await call(buildApp(null, { tenant: false }), "/sessions");
  assert.equal(r.status, 401);
  assert.equal((r.body as { error?: { code?: string } })?.error?.code, "unauthorized");
});
