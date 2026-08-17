/* SSL Postgres — politique unique (audit 2026-08-16 : rejectUnauthorized:false
   ouvrait un MITM sur URL publique).

   Résolution, par ordre :
   1. DATABASE_CA_CERT (PEM inline, `\n` échappés acceptés) ou
      DATABASE_CA_CERT_FILE → pinning de la CA, rejectUnauthorized: true.
   2. DB_SSL_INSECURE=1 → rejectUnauthorized: false + avertissement explicite
      (repli documenté si le proxy public présente un cert non vérifiable).
   3. Sinon, si l'URL demande SSL (sslmode=require) → vérification STRICTE
      du certificat (comportement par défaut de node-postgres).

   Sans sslmode=require dans l'URL → pas de SSL (réseau privé Railway). */

import { readFileSync } from "node:fs";

export interface SslConfig {
  rejectUnauthorized: boolean;
  ca?: string;
}

export function resolveDbSsl(
  databaseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): SslConfig | undefined {
  if (!/[?&]sslmode=require/.test(databaseUrl)) return undefined;

  const caInline = env.DATABASE_CA_CERT?.trim();
  const caFile = env.DATABASE_CA_CERT_FILE?.trim();
  if (caInline || caFile) {
    const ca = caInline ? caInline.replace(/\\n/g, "\n") : readFileSync(caFile!, "utf-8");
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
