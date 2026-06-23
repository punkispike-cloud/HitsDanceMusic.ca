/* Typage du contexte Hono partagé (variables posées par les middlewares). */

import type { Role } from "./db/schema.js";

export interface AuthUser {
  userId: string;
  role: Role;
  artistId: string | null;
  radioId: string | null; // null = owner (cross-radio)
}

export interface AppBindings {
  Variables: {
    user: AuthUser;
    // Radio courante résolue (mur multi-tenant). null = contexte cross-radio
    // (owner sans sélection) ou hôte public non résolu.
    radioId: string | null;
  };
}
