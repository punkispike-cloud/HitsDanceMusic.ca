/* Tokens.
   - Access : JWT HS256 court (15 min), porte { sub, role, artistId }.
   - Refresh : chaîne opaque aléatoire (PAS un JWT) — stockée hachée en DB
     pour permettre révocation réelle + rotation + détection de réutilisation. */

import { SignJWT, jwtVerify } from "jose";
import { randomBytes, createHash } from "node:crypto";
import { env } from "../env.js";
import type { Role } from "../db/schema.js";

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = "hitradio-api";

export interface AccessClaims {
  sub: string;
  role: Role;
  artistId: string | null;
  radioId: string | null;
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ role: claims.role, artistId: claims.artistId, radioId: claims.radioId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });
    if (typeof payload.sub !== "string") return null;
    return {
      sub: payload.sub,
      role: payload.role as Role,
      artistId: (payload.artistId as string | null) ?? null,
      radioId: (payload.radioId as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/** Génère un refresh token brut (à renvoyer au client une seule fois). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash stocké en DB (le brut n'est jamais persisté). */
export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/* ───────────────── Auditeurs (comptes grand public) ─────────────────
   Émetteur distinct → un token auditeur ne peut PAS servir sur les routes
   staff (et inversement), même clé HMAC partagée. Claims minimaux. */

const LISTENER_ISSUER = "enondes-listener";

export interface ListenerClaims {
  sub: string;
  email: string;
  name: string;
}

export async function signListenerToken(claims: ListenerClaims): Promise<string> {
  return new SignJWT({ email: claims.email, name: claims.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(LISTENER_ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL}s`)
    .sign(secret);
}

export async function verifyListenerToken(token: string): Promise<ListenerClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: LISTENER_ISSUER });
    if (typeof payload.sub !== "string") return null;
    return {
      sub: payload.sub,
      email: (payload.email as string) ?? "",
      name: (payload.name as string) ?? "",
    };
  } catch {
    return null;
  }
}
