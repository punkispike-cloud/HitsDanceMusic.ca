/* Test d'intégration RLS multi-tenant sur VRAIE base.
 *
 Valide que l'isolation par `app.radio_id` fonctionne : un tenant A ne voit PAS les
 lignes du tenant B, et le mode cross-radio (GUC vide) voit les deux. À lancer sur
 une base jetable ou de test (jamais en prod sans nettoyage — le script supprime ses
 propres données de test à la fin).
 *
 Pré-requis : migrations 0022-0025 appliquées (policies + FORCE RLS). Pour valider
 réellement l'isolation, se connecter avec le rôle applicatif `enondes_app` (non-
 superuser, NOBYPASSRLS) via RLS_TEST_URL ; sinon le test utilise DATABASE_URL et
 échouera si ce rôle bypass RLS (superuser) — c'est précisément le signal recherché.
 *
 Variables :
 *   DATABASE_URL   (requis) connexion propriétaire — setup (insert données de test)
 *   RLS_TEST_URL   (optionnel) connexion rôle enondes_app — vérif isolation.
 *                   Défaut = DATABASE_URL (avec avertissement).
 *
 Lancer :
 *   RLS_TEST_URL="postgres://enondes_app:***@host/db" \
 *   DATABASE_URL="postgres://owner:***@host/db" \
 *   node api/scripts/test-rls.mjs
 */

import pg from "pg";

const setupUrl = process.env.DATABASE_URL || "";
const testUrl = process.env.RLS_TEST_URL || setupUrl;

if (!setupUrl) {
  console.error("[test-rls] DATABASE_URL requis (setup).");
  process.exit(2);
}

if (testUrl === setupUrl) {
  console.warn("[test-rls] ⚠️  RLS_TEST_URL absent — utilisation de DATABASE_URL pour la vérif.");
  console.warn("             Si ce rôle est superuser/BYPASSRLS, RLS est bypassé et le test échouera (signal attendu).");
  console.warn("             Pour valider vraiment : pointer RLS_TEST_URL sur le rôle enondes_app.");
}

const ssl = (u) => (/railway|amazonaws|proxy\.rlwy/i.test(u) ? { rejectUnauthorized: false } : undefined);
const setupPool = new pg.Pool({ connectionString: setupUrl, ssl: ssl(setupUrl) });
const testPool = new pg.Pool({ connectionString: testUrl, ssl: ssl(testUrl) });

const SLUG_A = "rls-test-a";
const SLUG_B = "rls-test-b";
const SHOW_SLUG = "rls-isolation-test";

async function ensureRadio(pool, slug, name) {
  const r = await pool.query(
    `INSERT INTO radios (slug, name, status) VALUES ($1, $2, 'active')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [slug, name],
  );
  return r.rows[0].id;
}

async function insertShow(pool, radioId, slug, title) {
  const r = await pool.query(
    `INSERT INTO shows (radio_id, slug, title) VALUES ($1, $2, $3) RETURNING id`,
    [radioId, slug, title],
  );
  return r.rows[0].id;
}

/** Compte les lignes visibles pour un id de show donné, sous une GUC app.radio_id. */
async function countVisible(pool, guc, showId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.radio_id', $1, true)", [guc]);
    const r = await client.query("SELECT count(*)::int AS n FROM shows WHERE id = $1", [showId]);
    await client.query("COMMIT");
    return r.rows[0].n;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

let failures = 0;
let showA = null;
let showB = null;
let radioA = null;
let radioB = null;

const check = (label, cond, detail) => {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label} — ${detail}`);
  }
};

try {
  console.log("[test-rls] setup : création de deux radios + shows de test...");
  radioA = await ensureRadio(setupPool, SLUG_A, "RLS Test A");
  radioB = await ensureRadio(setupPool, SLUG_B, "RLS Test B");
  await setupPool.query("DELETE FROM shows WHERE radio_id IN ($1, $2)", [radioA, radioB]);
  showA = await insertShow(setupPool, radioA, SHOW_SLUG, "RLS_SHOW_A");
  showB = await insertShow(setupPool, radioB, SHOW_SLUG, "RLS_SHOW_B");
  console.log(`  radio A=${radioA} show A=${showA}\n  radio B=${radioB} show B=${showB}`);

  console.log("\n[test-rls] vérif isolation (rôle : " + (process.env.RLS_TEST_URL ? "enondes_app" : "DATABASE_URL") + ")");

  // Tenant A voit son show, PAS celui de B.
  const aSeesA = await countVisible(testPool, radioA, showA);
  const aSeesB = await countVisible(testPool, radioA, showB);
  check("Tenant A voit son propre show", aSeesA === 1, `count=${aSeesA}`);
  check("Tenant A ne voit PAS le show de B (isolation RLS)", aSeesB === 0, `count=${aSeesB} — RLS bypassé ? rôle superuser ou GUC non posée`);

  // Tenant B voit son show, PAS celui de A.
  const bSeesB = await countVisible(testPool, radioB, showB);
  const bSeesA = await countVisible(testPool, radioB, showA);
  check("Tenant B voit son propre show", bSeesB === 1, `count=${bSeesB}`);
  check("Tenant B ne voit PAS le show de A (isolation RLS)", bSeesA === 0, `count=${bSeesA}`);

  // Mode cross-radio (GUC vide) voit les deux.
  const crossA = await countVisible(testPool, "", showA);
  const crossB = await countVisible(testPool, "", showB);
  check("Mode cross-radio (GUC vide) voit le show A", crossA >= 1, `count=${crossA}`);
  check("Mode cross-radio (GUC vide) voit le show B", crossB >= 1, `count=${crossB}`);
} catch (err) {
  failures++;
  console.error("[test-rls] erreur d'exécution :", err instanceof Error ? err.message : err);
} finally {
  // Nettoyage : supprime les shows de test puis les radios (cascade).
  console.log("\n[test-rls] nettoyage...");
  try {
    if (radioA && radioB) {
      await setupPool.query("DELETE FROM shows WHERE radio_id IN ($1, $2)", [radioA, radioB]);
      await setupPool.query("DELETE FROM radios WHERE id IN ($1, $2)", [radioA, radioB]);
      console.log("  données de test supprimées.");
    }
  } catch (err) {
    console.error("  nettoyage échoué :", err instanceof Error ? err.message : err);
  }
  await setupPool.end().catch(() => {});
  await testPool.end().catch(() => {});
}

console.log(`\n[test-rls] ${failures === 0 ? "✅ RLS fonctionnelle — isolation confirmée." : `❌ ${failures} vérification(s) en échec.`}`);
process.exit(failures === 0 ? 0 : 1);
