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
import {
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  setPasswordSchema,
} from "../lib/validation.js";
import { badRequest, forbidden, unauthorized } from "../lib/errors.js";
import { env, refreshCookieSameSite } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import type { Context, Next } from "hono";
import {
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  userIdForRefreshToken,
  type TokenPair,
} from "../services/auth.js";
import { createAuthToken, consumeAuthToken } from "../services/auth-tokens.js";
import { sendEmail, resetEmailHtml } from "../services/email.js";
import type { AppBindings } from "../types.js";

const REFRESH_COOKIE = "hr_refresh";

function setRefreshCookie(c: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    // En prod, l'admin et l'api sont sur des domaines distincts
    // (*.up.railway.app = cross-site) → le cookie doit être SameSite=None
    // pour être transmis. En dev local (http, même host), Lax suffit.
    // Une fois les domaines custom posés (même parent), ops pose
    // COOKIE_SAMESITE=lax → SameSite=Lax (cf. refreshCookieSameSite).
    sameSite: refreshCookieSameSite(),
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

/* Garde CSRF (défense en profondeur — audit 2026-08-16) : le cookie refresh est
   SameSite=None en prod (admin cross-site *.up.railway.app), donc un POST
   cross-site navigateur transporterait le cookie. Le CORS bloque déjà la
   LECTURE de la réponse, mais la rotation/révocation (changement d'état) aurait
   quand même lieu. On rejette toute requête dont l'Origin est présente et hors
   whitelist. Les clients non-navigateur n'envoient pas d'Origin → non concernés.
   Appliqué aux routes qui consomment le cookie : /refresh et /logout. */
async function csrfOriginGuard(c: Context, next: Next) {
  const origin = c.req.header("Origin");
  if (
    origin &&
    !env.ALLOWED_ORIGINS.includes("*") &&
    !env.ALLOWED_ORIGINS.includes(origin)
  ) {
    throw forbidden("Origine non autorisée", "csrf_origin");
  }
  await next();
}
authRoutes.use("/refresh", csrfOriginGuard);
authRoutes.use("/logout", csrfOriginGuard);

/* La création de comptes équipe passe par POST /v1/admin/users (scopé radio).
   Pas de /auth/register séparé : il créait des comptes hors-tenant (radio_id NULL). */

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
      // « Déconnecter partout » : révoquer toutes les sessions même si le token
      // présenté est expiré/inconnu à la rotation (on résout l'user par le hash).
      const userId = await userIdForRefreshToken(raw);
      if (userId) await revokeAllForUser(userId);
    } else {
      await revokeRefreshToken(raw);
    }
  }
  deleteCookie(c, REFRESH_COOKIE, { path: "/auth" });
  return c.json({ ok: true });
});

/* POST /auth/forgot-password — envoie un lien de réinitialisation.
   Réponse toujours { ok:true } (ne révèle pas si l'email existe). */
authRoutes.post("/forgot-password", async (c) => {
  const { email } = forgotPasswordSchema.parse(await c.req.json());
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (user && user.isActive) {
    const raw = await createAuthToken(user.id, "reset", 60 * 60); // 1 h
    const link = `${env.ADMIN_BASE_URL.replace(/\/$/, "")}/set-password?token=${raw}`;
    await sendEmail({
      to: user.email,
      subject: "Réinitialisation de ton mot de passe — Hits Dance Music",
      html: resetEmailHtml(link),
    });
  }
  return c.json({ ok: true });
});

/* POST /auth/set-password — consomme un jeton (invite ou reset) et fixe le mdp.
   Révoque toutes les sessions existantes. */
authRoutes.post("/set-password", async (c) => {
  const { token, password } = setPasswordSchema.parse(await c.req.json());
  const userId = await consumeAuthToken(token);
  if (!userId) throw badRequest("Lien invalide ou expiré", "invalid_token");
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), isActive: true, updatedAt: new Date() })
    .where(eq(users.id, userId));
  await revokeAllForUser(userId);
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
