/* Auth des AUDITEURS (grand public, catalogue à la demande). Miroir de
   services/auth.ts mais sur les tables `listeners` / `listener_refresh_tokens`.
   Séparé du staff : aucun rôle, aucun accès admin. */

import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { listeners, listenerRefreshTokens, type Listener } from "../db/schema.js";
import { signListenerToken, generateRefreshToken, hashRefreshToken } from "../lib/jwt.js";
import { env } from "../env.js";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Émet un access + refresh pour un auditeur et persiste le hash du refresh. */
export async function issueListenerTokens(listener: Listener, userAgent?: string): Promise<TokenPair> {
  const accessToken = await signListenerToken({
    sub: listener.id,
    email: listener.email,
    name: listener.displayName,
  });
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000);
  await db.insert(listenerRefreshTokens).values({
    listenerId: listener.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt,
    userAgent: userAgent?.slice(0, 300),
  });
  return { accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_TTL };
}

export interface RotateResult {
  pair: TokenPair;
  listener: Listener;
}

/** Vérifie un refresh auditeur, le fait tourner, renvoie une nouvelle paire.
    Réutilisation d'un token révoqué → révoque toute la chaîne (vol suspecté). */
export async function rotateListenerToken(raw: string, userAgent?: string): Promise<RotateResult | null> {
  const tokenHash = hashRefreshToken(raw);
  const row = await db.query.listenerRefreshTokens.findFirst({
    where: eq(listenerRefreshTokens.tokenHash, tokenHash),
  });
  if (!row) return null;
  if (row.revokedAt) {
    await revokeAllForListener(row.listenerId);
    return null;
  }
  if (row.expiresAt.getTime() < Date.now()) return null;

  const listener = await db.query.listeners.findFirst({ where: eq(listeners.id, row.listenerId) });
  if (!listener || !listener.isActive) return null;

  const pair = await issueListenerTokens(listener, userAgent);
  const newRow = await db.query.listenerRefreshTokens.findFirst({
    where: eq(listenerRefreshTokens.tokenHash, hashRefreshToken(pair.refreshToken)),
  });
  await db
    .update(listenerRefreshTokens)
    .set({ revokedAt: new Date(), replacedBy: newRow?.id ?? null })
    .where(eq(listenerRefreshTokens.id, row.id));

  return { pair, listener };
}

/** Révoque un refresh précis (logout simple). */
export async function revokeListenerToken(raw: string): Promise<void> {
  const tokenHash = hashRefreshToken(raw);
  await db
    .update(listenerRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(listenerRefreshTokens.tokenHash, tokenHash), isNull(listenerRefreshTokens.revokedAt)));
}

/** Révoque tous les refresh actifs d'un auditeur (logout global). */
export async function revokeAllForListener(listenerId: string): Promise<void> {
  await db
    .update(listenerRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(listenerRefreshTokens.listenerId, listenerId), isNull(listenerRefreshTokens.revokedAt)));
}
