/* Handler d'erreur global : traduit AppError + ZodError en JSON normalisé.
   Aucune stack ni détail interne renvoyé en production. */

import type { Context } from "hono";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { env } from "../env.js";
import { captureError } from "../services/monitoring.js";

export function onError(err: Error, c: Context): Response {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status);
  }
  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: "Données invalides",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      400,
    );
  }
  console.error("[api] unhandled error", err);
  captureError(err, { path: c.req.path, method: c.req.method });
  return c.json(
    {
      error: {
        code: "internal_error",
        message: env.isProd ? "Erreur interne" : err.message,
      },
    },
    500,
  );
}

export function notFoundHandler(c: Context): Response {
  return c.json({ error: { code: "not_found", message: "Route introuvable" } }, 404);
}
