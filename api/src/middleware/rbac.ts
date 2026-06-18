/* Contrôle d'accès basé sur les rôles.
   - requireRole(...) : refuse si le rôle courant n'est pas listé.
   - requireOwnershipOrAdmin(loader) : superadmin passe toujours ; sinon la
     ressource chargée doit appartenir à l'artiste de l'utilisateur. */

import type { MiddlewareHandler } from "hono";
import { forbidden, notFound } from "../lib/errors.js";
import type { AppBindings, AuthUser } from "../types.js";
import type { Role } from "../db/schema.js";

export function requireRole(...roles: Role[]): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const user = c.get("user");
    if (!roles.includes(user.role)) throw forbidden("Rôle insuffisant");
    await next();
  };
}

/** Hiérarchie : superadmin > animateur > lecteur. */
const RANK: Record<Role, number> = { lecteur: 1, animateur: 2, superadmin: 3 };
export function requireMinRole(min: Role): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const user = c.get("user");
    if (RANK[user.role] < RANK[min]) throw forbidden("Rôle insuffisant");
    await next();
  };
}

type OwnerLoader = (id: string) => Promise<{ artistId: string | null } | undefined>;

/** Vérifie la propriété d'une ressource identifiée par le param `:id`. */
export function requireOwnershipOrAdmin(loader: OwnerLoader): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const user = c.get("user");
    if (user.role === "superadmin") return next();
    const id = c.req.param("id");
    if (!id) throw notFound();
    const resource = await loader(id);
    if (!resource) throw notFound();
    if (!user.artistId || resource.artistId !== user.artistId) {
      throw forbidden("Tu ne peux modifier que ton propre contenu");
    }
    await next();
  };
}

/** Helper hors middleware : un animateur ne peut écrire que son contenu. */
export function assertCanActAs(user: AuthUser, targetArtistId: string | null): void {
  if (user.role === "superadmin") return;
  if (!user.artistId || targetArtistId !== user.artistId) {
    throw forbidden("Tu ne peux agir que sur ton propre contenu");
  }
}
