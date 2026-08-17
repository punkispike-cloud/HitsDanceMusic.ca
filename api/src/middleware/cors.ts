/* CORS : reflète l'origine seulement si elle est whitelistée (env.ALLOWED_ORIGINS).
   credentials:true uniquement pour ces origines (cookies refresh). Même
   posture que le service presence (refus par défaut). */

import { cors } from "hono/cors";
import { env } from "../env.js";

export const corsMiddleware = cors({
  origin: (origin) => {
    if (!origin) return undefined; // requêtes non-navigateur : pas d'en-tête CORS
    if (env.ALLOWED_ORIGINS.includes("*")) return origin;
    return env.ALLOWED_ORIGINS.includes(origin) ? origin : undefined;
  },
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Radio-Id"],
  credentials: true,
  maxAge: 86_400,
});
