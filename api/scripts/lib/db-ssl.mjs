/* SSL Postgres pour les scripts api/ — copie de scripts/lib/db-ssl.mjs
   (les scripts .mjs ne peuvent pas importer le TS de src/). Voir ce fichier
   pour la politique complète. */

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
