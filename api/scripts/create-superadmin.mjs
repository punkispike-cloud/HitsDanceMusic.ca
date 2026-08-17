/* Script ponctuel : crée (ou met à jour) UN compte superadmin, sans toucher aux
   autres comptes ni redéployer l'app. Idempotent via ON CONFLICT (email).

   Lancer avec le DATABASE_URL de prod injecté par Railway :
     railway run --service patient-endurance \
       node scripts/create-superadmin.mjs

   Entrées (variables d'env) :
     NEW_ADMIN_EMAIL      (requis) e-mail du compte
     NEW_ADMIN_PASSWORD   (requis) mot de passe en clair (sera haché bcrypt)
     NEW_ADMIN_NAME       (optionnel) nom affiché — défaut « Super Admin »
     NEW_ADMIN_RADIO_SLUG (optionnel) slug de la radio de rattachement —
                          défaut SEED_BRAND, sinon la 1re radio créée. */

import pg from "pg";
import bcrypt from "bcryptjs";
import { resolveDbSsl } from "./lib/db-ssl.mjs";

const email = (process.env.NEW_ADMIN_EMAIL || "").trim().toLowerCase();
const password = process.env.NEW_ADMIN_PASSWORD || "";
const displayName = (process.env.NEW_ADMIN_NAME || "Super Admin").trim();
const radioSlug = (process.env.NEW_ADMIN_RADIO_SLUG || process.env.SEED_BRAND || "").trim();
const cost = Number.parseInt(process.env.BCRYPT_COST || "12", 10) || 12;

if (!email || !password) {
  console.error("[create-superadmin] ❌ NEW_ADMIN_EMAIL et NEW_ADMIN_PASSWORD sont requis.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("[create-superadmin] ❌ DATABASE_URL absent (lancer via `railway run`).");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolveDbSsl(process.env.DATABASE_URL),
});

try {
  // Radio de rattachement : par slug si fourni, sinon la plus ancienne.
  let radioId = null;
  if (radioSlug) {
    const r = await pool.query("SELECT id FROM radios WHERE slug = $1 LIMIT 1", [radioSlug]);
    if (r.rows[0]) radioId = r.rows[0].id;
  }
  if (!radioId) {
    const r = await pool.query("SELECT id, slug FROM radios ORDER BY created_at ASC LIMIT 1");
    if (r.rows[0]) {
      radioId = r.rows[0].id;
      console.log(`[create-superadmin] radio de rattachement : ${r.rows[0].slug}`);
    } else {
      console.error("[create-superadmin] ❌ aucune radio en base — impossible de rattacher le compte.");
      process.exit(1);
    }
  }

  const passwordHash = await bcrypt.hash(password, cost);

  const res = await pool.query(
    `INSERT INTO users (email, password_hash, display_name, role, radio_id, is_active)
     VALUES ($1, $2, $3, 'superadmin', $4, true)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       display_name  = EXCLUDED.display_name,
       role          = 'superadmin',
       is_active     = true,
       updated_at    = now()
     RETURNING id, email, role, (xmax = 0) AS inserted`,
    [email, passwordHash, displayName, radioId],
  );

  const row = res.rows[0];
  console.log(
    `[create-superadmin] ✓ ${row.inserted ? "créé" : "mis à jour"} : ${row.email} (role=${row.role}, id=${row.id})`,
  );
} catch (err) {
  console.error("[create-superadmin] ❌ échec :", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
