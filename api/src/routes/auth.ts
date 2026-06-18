/* Routes d'authentification.
   Refresh token : transmis via cookie httpOnly (navigateur/admin) OU dans le
   body (clients non-navigateur). Access token : renvoyé en JSON, gardé en
   mémoire côté client (jamais localStorage). */

import { Hono } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { loginSchema, registerSchema, changePasswordSchema } from "../lib/validation.js";
import { badRequest, unauthorized, conflict } from "../lib/errors.js";
import { env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import {
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  type TokenPair,
} from "../services/auth.js";
import type { AppBindings } from "../types.js";

const REFRESH_COOKIE = "hr_refresh";

function setRefreshCookie(c: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "Strict",
    path: "/auth",
    maxAge: env.REFRESH_TOKEN_TTL,
  });
}

function publicUser(u: { id: string; email: string; displayName: string; role: string; artistId: string | null }) {
  return { id: u.id, email: u.email, displayName: u.displayName, role: u.role, artistId: u.artistId };
}

function tokenResponse(pair: TokenPair) {
  return { accessToken: pair.accessToken, tokenType: "Bearer", expiresIn: pair.expiresIn };
}

export const authRoutes = new Hono<AppBindings>();

/* POST /auth/register — création de compte équipe (superadmin uniquement). */
authRoutes.post("/register", requireAuth, requireRole("superadmin"), async (c) => {
  const body = registerSchema.parse(await c.req.json());
  const existing = await db.query.users.findFirst({ where: eq(users.email, body.email) });
  if (existing) throw conflict("Un compte existe déjà avec cet email", "email_taken");
  const [created] = await db
    .insert(users)
    .values({
      email: body.email,
      passwordHash: await hashPassword(body.password),
      displayName: body.displayName,
      role: body.role,
      artistId: body.artistId ?? null,
    })
    .returning();
  return c.json({ user: publicUser(created!) }, 201);
});

/* POST /auth/login — vérifie les identifiants, émet une paire de tokens. */
authRoutes.post("/login", async (c) => {
  const body = loginSchema.parse(await c.req.json());
  const user = await db.query.users.findFirst({ where: eq(users.email, body.email) });
  // Réponse identique (mauvais email vs mauvais mdp) pour ne pas révéler l'existence.
  if (!user || !user.isActive) throw unauthorized("Identifiants invalides", "invalid_credentials");
  const ok = await verifyPassword(body.password, user.passwordHash);
  if (!ok) throw unauthorized("Identifiants invalides", "invalid_credentials");

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  const pair = await issueTokenPair(user, c.req.header("User-Agent"));
  setRefreshCookie(c, pair.refreshToken);
  return c.json({ ...tokenResponse(pair), user: publicUser(user) });
});

/* POST /auth/refresh — rotation du refresh, nouvelle paire. */
authRoutes.post("/refresh", async (c) => {
  let raw = getCookie(c, REFRESH_COOKIE);
  if (!raw) {
    const body = await c.req.json().catch(() => ({}));
    if (body && typeof body.refreshToken === "string") raw = body.refreshToken;
  }
  if (!raw) throw unauthorized("Refresh token manquant", "no_refresh");
  const result = await rotateRefreshToken(raw, c.req.header("User-Agent"));
  if (!result) {
    deleteCookie(c, REFRESH_COOKIE, { path: "/auth" });
    throw unauthorized("Refresh token invalide", "invalid_refresh");
  }
  setRefreshCookie(c, result.pair.refreshToken);
  return c.json({ ...tokenResponse(result.pair), user: publicUser(result.user) });
});

/* POST /auth/logout — révoque le refresh courant (ou tous si all=true). */
authRoutes.post("/logout", async (c) => {
  let raw = getCookie(c, REFRESH_COOKIE);
  const body = await c.req.json().catch(() => ({}));
  if (!raw && body && typeof body.refreshToken === "string") raw = body.refreshToken;
  if (raw) {
    if (body?.all === true) {
      const result = await rotateRefreshToken(raw).catch(() => null);
      if (result) await revokeAllForUser(result.user.id);
    } else {
      await revokeRefreshToken(raw);
    }
  }
  deleteCookie(c, REFRESH_COOKIE, { path: "/auth" });
  return c.json({ ok: true });
});

/* GET /auth/me — profil courant. */
authRoutes.get("/me", requireAuth, async (c) => {
  const { userId } = c.get("user");
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw unauthorized();
  return c.json({ user: publicUser(user) });
});

/* POST /auth/change-password — change le mdp, révoque tous les refresh. */
authRoutes.post("/change-password", requireAuth, async (c) => {
  const { userId } = c.get("user");
  const body = changePasswordSchema.parse(await c.req.json());
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw unauthorized();
  if (!(await verifyPassword(body.oldPassword, user.passwordHash))) {
    throw badRequest("Ancien mot de passe incorrect", "wrong_password");
  }
  if (body.oldPassword === body.newPassword) {
    throw badRequest("Le nouveau mot de passe doit différer de l'ancien");
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(body.newPassword), updatedAt: new Date() })
    .where(eq(users.id, userId));
  await revokeAllForUser(userId);
  deleteCookie(c, REFRESH_COOKIE, { path: "/auth" });
  return c.json({ ok: true });
});
