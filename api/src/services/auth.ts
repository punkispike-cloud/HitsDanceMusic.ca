/* Logique d'authentification touchant la DB : émission de paires de tokens,
   rotation, révocation. Séparé des routes pour rester testable. */

import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, refreshTokens, type User } from "../db/schema.js";
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from "../lib/jwt.js";
import { env } from "../env.js";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Émet un nouvel access + refresh et persiste le hash du refresh. */
export async function issueTokenPair(user: User, userAgent?: string): Promise<TokenPair> {
  const accessToken = await signAccessToken({
    sub: user.id,
    role: user.role,
    artistId: user.artistId,
    radioId: user.radioId,
  });
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000);
  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt,
    userAgent: userAgent?.slice(0, 300),
  });
  return { accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_TTL };
}

export interface RotateResult {
  pair: TokenPair;
  user: User;
}

/** Vérifie un refresh, le fait tourner, renvoie une nouvelle paire.
   - Token inconnu/expiré → null.
   - Token DÉJÀ révoqué présenté à nouveau → réutilisation suspecte :
     on révoque toute la chaîne de l'utilisateur et on renvoie null. */
export async function rotateRefreshToken(
  raw: string,
  userAgent?: string,
): Promise<RotateResult | null> {
  const tokenHash = hashRefreshToken(raw);
  const row = await db.query.refreshTokens.findFirst({
    where: eq(refreshTokens.tokenHash, tokenHash),
  });
  if (!row) return null;

  // Réutilisation d'un token révoqué → on coupe tout pour cet utilisateur.
  if (row.revokedAt) {
    await revokeAllForUser(row.userId);
    return null;
  }
  if (row.expiresAt.getTime() < Date.now()) return null;

  const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
  if (!user || !user.isActive) return null;

  const pair = await issueTokenPair(user, userAgent);
  // Marque l'ancien révoqué + lien de rotation (chaîne auditable).
  const newRow = await db.query.refreshTokens.findFirst({
    where: eq(refreshTokens.tokenHash, hashRefreshToken(pair.refreshToken)),
  });
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), replacedBy: newRow?.id ?? null })
    .where(eq(refreshTokens.id, row.id));

  return { pair, user };
}

/** Révoque un refresh précis (logout simple). */
export async function revokeRefreshToken(raw: string): Promise<void> {
  const tokenHash = hashRefreshToken(raw);
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
}

/** Révoque tous les refresh actifs d'un utilisateur (logout global,
   changement de mot de passe, détection de vol). */
export async function revokeAllForUser(userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
