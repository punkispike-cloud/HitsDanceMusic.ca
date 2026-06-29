/* Contrôle d'accès basé sur les rôles — deux axes de capacité.
   - requireRole(...) : refuse si le rôle courant n'est pas listé.
   - isEditorialAdmin(role) : superadmin + owner (gère le contenu, court-circuite
     l'ownership). EXCLUT `it`.
   - isCrossRadio(role) : owner + it (parc / technique cross-radio). EXCLUT
     superadmin.
   - requireOwnershipOrAdmin(loader) : editorial admin passe toujours ; sinon la
     ressource chargée doit appartenir à l'artiste de l'utilisateur. `it` est
     traité comme un non-admin éditorial (il n'a pas d'artiste → 403). */

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

/** Hiérarchie linéaire (anti-escalade + gestion de comptes uniquement) :
    owner > it > superadmin > animateur > lecteur.
    `owner` = En Ondes (god mode, cross-radio) ; `it` = technique cross-radio ;
    `superadmin` = admin d'UNE radio cliente. NB : ce rang ne dit rien des
    CAPACITÉS — il sert seulement à empêcher qu'un rôle attribue/gère un rang
    supérieur au sien. Les capacités sont exprimées par les deux axes ci-dessous. */
export const RANK: Record<Role, number> = { lecteur: 1, animateur: 2, superadmin: 3, it: 4, owner: 5 };

/** Axe ÉDITORIAL : gère le contenu d'une radio (court-circuite l'ownership).
    = `superadmin` (sa radio) + `owner` (god mode). EXCLUT `it` (technique, pas
    éditorial) — c'est le point critique du refactor. */
export function isEditorialAdmin(role: Role): boolean {
  return role === "superadmin" || role === "owner";
}

/** Axe CROSS-RADIO (parc / technique) : `owner` (god mode) + `it` (technique).
    EXCLUT `superadmin` (scopé à une seule radio cliente). */
export function isCrossRadio(role: Role): boolean {
  return role === "owner" || role === "it";
}

/** Réservé au propriétaire de la plateforme En Ondes (commercial, god mode). */
export const requireOwner = requireRole("owner");

/** Technique cross-radio : owner + it (monitoring parc, santé, alertes). */
export const requireItOrOwner = requireRole("it", "owner");

/** Éditorial : superadmin + owner (exclut `it`). */
export const requireEditorialAdmin = requireRole("superadmin", "owner");

export function requireMinRole(min: Role): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const user = c.get("user");
    if (RANK[user.role] < RANK[min]) throw forbidden("Rôle insuffisant");
    await next();
  };
}

type OwnerLoader = (id: string) => Promise<{ artistId: string | null } | undefined>;

/** Vérifie la propriété d'une ressource. Les admins éditoriaux (superadmin/owner)
    court-circuitent l'ownership ; `it` NON (il n'édite pas le contenu). */
export function requireOwnershipOrAdmin(loader: OwnerLoader): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const user = c.get("user");
    if (isEditorialAdmin(user.role)) return next();
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

/** Helper hors middleware : un animateur ne peut écrire que son contenu.
    Les admins éditoriaux passent partout ; `it` NON (pas éditorial). */
export function assertCanActAs(user: AuthUser, targetArtistId: string | null): void {
  if (isEditorialAdmin(user.role)) return;
  if (!user.artistId || targetArtistId !== user.artistId) {
    throw forbidden("Tu ne peux agir que sur ton propre contenu");
  }
}

/** Anti-escalade : on n'ATTRIBUE jamais un rôle supérieur au sien.
    → un `superadmin` ne peut pas créer/promouvoir un `owner`. */
export function assertCanAssignRole(actor: AuthUser, targetRole: Role): void {
  if (RANK[targetRole] > RANK[actor.role]) {
    throw forbidden("Tu ne peux pas attribuer un rôle supérieur au tien");
  }
}

/** Anti-escalade : on ne GÈRE (modifie/supprime/désactive) jamais un compte de
    rang supérieur au sien. → un `superadmin` ne peut pas toucher un `owner`. */
export function assertCanManageUser(actor: AuthUser, targetRole: Role): void {
  if (RANK[targetRole] > RANK[actor.role]) {
    throw forbidden("Tu ne peux pas gérer un compte de rang supérieur");
  }
}
