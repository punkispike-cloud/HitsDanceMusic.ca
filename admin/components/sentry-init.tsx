/* Monitoring d'erreurs (Sentry) — console admin.
   Inactif tant que NEXT_PUBLIC_SENTRY_DSN n'est pas fourni (même posture que l'API). */

"use client";

import { useEffect } from "react";

let started = false;

export function SentryInit() {
  useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
    if (!dsn || started) return;
    started = true;
    void import("@sentry/browser")
      .then((Sentry) => {
        Sentry.init({
          dsn,
          environment: process.env.NODE_ENV || "production",
          tracesSampleRate: 0,
        });
      })
      .catch(() => {
        /* SDK indisponible → on reste silencieux (console native) */
        started = false;
      });
  }, []);
  return null;
}
