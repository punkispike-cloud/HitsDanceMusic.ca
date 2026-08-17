/* SSL Postgres pour les scripts ops — même politique que api/src/lib/db-ssl.ts
   (audit 2026-08-16 : rejectUnauthorized:false ouvrait un MITM sur URL publique).

   resolveDbSsl(url, env) →
   1. DATABASE_CA_CERT (PEM inline, `\n` échappés acceptés) ou
      DATABASE_CA_CERT_FILE → { ca, rejectUnauthorized: true } (pinning).
   2. DB_SSL_INSECURE=1 → { rejectUnauthorized: false } + avertissement.
   3. sslmode=require dans l'URL → { rejectUnauthorized: true } (strict).
   4. Sinon → undefined (pas de SSL : réseau privé Railway).

   Les scripts historiques détectaient SSL via /railway|amazonaws|proxy\.rlwy/
   sur l'URL : ce test est conservé comme ALIAS de sslmode=require, car les
   URLs publiques Railway n'ont pas toujours le paramètre. */

import { readFileSync } from "node:fs";

export function resolveDbSsl(databaseUrl, env = process.env) {
  const wantsSsl =
    /[?&]sslmode=require/.test(databaseUrl) ||
    /railway|amazonaws|proxy\.rlwy/i.test(databaseUrl);
  if (!wantsSsl) return undefined;

  const caInline = env.DATABASE_CA_CERT?.trim();
  const caFile = env.DATABASE_CA_CERT_FILE?.trim();
  if (caInline || caFile) {
    const ca = caInline ? caInline.replace(/\\n/g, "\n") : readFileSync(caFile, "utf-8");
    return { rejectUnauthorized: true, ca };
  }

  if (env.DB_SSL_INSECURE === "1") {
    console.warn(
      "[db-ssl] DB_SSL_INSECURE=1 — vérification du certificat DÉSACTIVÉE (MITM possible). " +
        "Préférer DATABASE_CA_CERT dès que possible.",
    );
    return { rejectUnauthorized: false };
  }

  return { rejectUnauthorized: true };
}
