/* Applique les migrations SQL versionnées (dossier ./migrations).
   À lancer en commande release Railway (pas dans le CMD du serveur) ou
   manuellement : `npm run db:migrate`. */

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { env } from "../env.js";

const { Pool } = pg;

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle(pool);
  console.log("[migrate] application des migrations…");
  await migrate(db, { migrationsFolder: "./migrations" });
  console.log("[migrate] terminé ✓");
  await pool.end();
}

main().catch((err) => {
  console.error("[migrate] échec", err);
  process.exit(1);
});
