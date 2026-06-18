/* requireAuth : extrait le Bearer, vérifie le JWT access, pose `user` sur
   le contexte. 401 si absent/invalide/expiré. */

import type { MiddlewareHandler } from "hono";
import { verifyAccessToken } from "../lib/jwt.js";
import { unauthorized } from "../lib/errors.js";
import type { AppBindings } from "../types.js";

export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const header = c.req.header("Authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw unauthorized("Token d'accès manquant");
  const claims = await verifyAccessToken(match[1]!);
  if (!claims) throw unauthorized("Token d'accès invalide ou expiré", "invalid_token");
  c.set("user", { userId: claims.sub, role: claims.role, artistId: claims.artistId });
  await next();
};
