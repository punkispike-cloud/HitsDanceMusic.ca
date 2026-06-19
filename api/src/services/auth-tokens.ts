/* Jetons à usage unique pour « définir/réinitialiser le mot de passe ».
   Le brut est renvoyé une seule fois (mis dans le lien email) ; seul le SHA-256
   est stocké. Consommation atomique (usedAt) → un lien ne sert qu'une fois. */

import { randomBytes, createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { authTokens } from "../db/schema.js";

export type TokenPurpose = "invite" | "reset";

function hash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Crée un jeton, renvoie le brut (à insérer dans le lien). */
export async function createAuthToken(
  userId: string,
  purpose: TokenPurpose,
  ttlSec: number,
): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await db.insert(authTokens).values({
    userId,
    tokenHash: hash(raw),
    purpose,
    expiresAt: new Date(Date.now() + ttlSec * 1000),
  });
  return raw;
}

/** Consomme un jeton valide (non expiré, non utilisé). Renvoie le userId. */
export async function consumeAuthToken(raw: string): Promise<string | null> {
  const tokenHash = hash(raw);
  const row = await db.query.authTokens.findFirst({
    where: and(
      eq(authTokens.tokenHash, tokenHash),
      isNull(authTokens.usedAt),
      gt(authTokens.expiresAt, new Date()),
    ),
  });
  if (!row) return null;
  await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
  return row.userId;
}
