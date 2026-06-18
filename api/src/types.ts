/* Typage du contexte Hono partagé (variables posées par les middlewares). */

import type { Role } from "./db/schema.js";

export interface AuthUser {
  userId: string;
  role: Role;
  artistId: string | null;
}

export interface AppBindings {
  Variables: {
    user: AuthUser;
  };
}
