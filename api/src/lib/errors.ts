/* Erreurs applicatives normalisées. Le handler global les traduit en
   réponses JSON { error: { code, message } } sans fuite de stack en prod. */

import { ContentfulStatusCode } from "hono/utils/http-status";

export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg = "Requête invalide", code = "bad_request") =>
  new AppError(400, code, msg);
export const unauthorized = (msg = "Authentification requise", code = "unauthorized") =>
  new AppError(401, code, msg);
export const forbidden = (msg = "Accès refusé", code = "forbidden") =>
  new AppError(403, code, msg);
export const notFound = (msg = "Ressource introuvable", code = "not_found") =>
  new AppError(404, code, msg);
export const conflict = (msg = "Conflit", code = "conflict") =>
  new AppError(409, code, msg);
export const tooMany = (msg = "Trop de requêtes", code = "rate_limited") =>
  new AppError(429, code, msg);
