#!/usr/bin/env node
/* Garde statique anti-fuite multi-tenant (C1.1).
   Scanne api/src/routes/*.ts + api/src/services/*.ts et rejette tout accès à une
   table tenant (toute table porteuse de `radio_id`) sans référence à `radioId` /
   `radio_id` dans le même bloc (handler de route ou fonction de service).

   Approche pragmatique (grep contextuel « AST léger ») :
   - Un « bloc » = une inscription de route au niveau racine
     (`xxxRoutes.get/post/patch/delete(...)`) OU une fonction/flèche déclarée au
     niveau racine (`function f()`, `const f = async () =>`, `const f = () =>`).
     Les flèches internes indentées (ex. `.map(async (s) => ...)`) NE sont PAS des
     ancres : elles restent dans le bloc de la fonction englobante.
   - Un bloc est SIGNALÉ s'il contient au moins une requête tenant
     (db.select/delete/update/insert sur une table tenant, db.query.<table>.*,
     .from/.leftJoin/.innerJoin/.join(<table tenant>), ou une table snake_case
     citée dans un sql`...`) ET qu'aucun token `radioId` / `radio_id` n'apparaît
     dans le bloc.

   Faux positifs connus, gérés via allowlists (cf. ALLOWED_FILES / ALLOWED_BLOCKS) :
   - routes/owner.ts      : console opérateur cross-radio (requireItOrOwner/requireOwner).
   - routes/auth.ts       : auth cross-radio (login par email, reset — hors adminTenant).
   - services/auth.ts     : logique d'auth cross-radio (rotation refresh → lookup user par id).
   - services/maintenance.ts : purge globale par date (cross-radio par conception).
   - services/monitor.ts  : job cross-radio ; ownerEmails() liste tous les owners.
   - services/reports.ts  : job cross-radio ; ownerEmails() liste tous les owners.
   - load{Show,Slot,Episode,Mix}Owner : loaders d'ownership par PK (le scoping radio_id
     se fait au moment de la mutation, pas du lookup).
   - likeCount : compte les likes par track_id (le titre est déjà scopé radio par l'appelant).

   Limites documentées :
   - Vérification au niveau du bloc (pas de la requête) : un bloc contenant `radioId`
     passe même si une requête précise l'omet (ex. lookup par PK dans un handler qui
     scoped par ailleurs). C'est voulu : on chasse les handlers qui OUBLIENT radioId,
     pas les lookup par PK légitimes.
   - Le SQL brut (db.execute(sql`...`)) est détecté par recherche du nom snake_case de
     la table entre backticks ; un SQL construit par concaténation hors template échappe
   au scanner (aucun cas actuel).
   - Ne remplace pas une RLS Postgres ; c'est un filet anti-régression sur le code.
*/
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = [join(ROOT, "src", "routes"), join(ROOT, "src", "services")];

/* Tables tenant = toutes les tables porteuses de `radio_id` (cf. src/db/schema.ts).
   Identifiants Drizzle (camelCase) + noms SQL (snake_case, pour le SQL brut). */
const TENANT_TABLES = [
  "artists", "users", "shows", "scheduleSlots", "episodes", "mixes",
  "uploadIntents", "analyticsSessions", "analyticsShowListen", "trackHistory",
  "trackLikes", "pushSubscriptions", "auditLog", "reportLog", "songRequests",
  "polls", "pollVotes",
];
const TENANT_SNAKE = [
  "artists", "users", "shows", "schedule_slots", "episodes", "mixes",
  "upload_intents", "analytics_sessions", "analytics_show_listen", "track_history",
  "track_likes", "push_subscriptions", "audit_log", "report_log", "song_requests",
  "polls", "poll_votes",
];

/* Fichiers entièrement cross-radio par conception → ignorés. */
const ALLOWED_FILES = new Set([
  "src/routes/owner.ts",
  "src/routes/auth.ts",
  "src/services/auth.ts",
  "src/services/maintenance.ts",
  "src/services/monitor.ts",
  "src/services/reports.ts",
]);

/* Blocs (par nom de fonction/const ou signature de route) légitimes sans radioId. */
const ALLOWED_BLOCKS = new Set([
  "loadShowOwner",
  "loadSlotOwner",
  "loadEpisodeOwner",
  "loadMixOwner",
  "likeCount",
]);

const CAMEL_ALT = TENANT_TABLES.join("|");
const SNAKE_ALT = TENANT_SNAKE.join("|");

/* Détecte un accès Drizzle à une table tenant sur une ligne. */
const DRIZZLE_RE = new RegExp(
  [
    `db\\.query\\.(${CAMEL_ALT})\\.`, // db.query.shows.findFirst(...)
    `db\\.(?:delete|update|insert)\\(\\s*(${CAMEL_ALT})\\b`, // db.delete(artists)
    `\\.(?:from|leftJoin|innerJoin|join|rightJoin|fullJoin)\\(\\s*(${CAMEL_ALT})\\b`, // .from(artists)
  ].join("|"),
);

/* Détecte un nom de table snake_case DANS un template SQL taggé `sql`...`` (SQL
   brut via db.execute). On ne scanne PAS le mot nu : `users` apparaît aussi dans
   des annotations de type (`typeof users.$inferSelect`) — on restreint donc aux
   backticks taggés `sql`. */
const RAW_SQL_RE = new RegExp(String.raw`\b(${SNAKE_ALT})\b`);

/* Ancres de bloc au niveau racine (colonne 0). */
const ANCHOR_RE =
  /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(|^([A-Za-z_$][\w$]*)\.(?:get|post|patch|delete|put)\s*\(\s*["'`]([^"'`]+)["'`]/;

function listTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...listTsFiles(p));
    else if (entry.endsWith(".ts")) out.push(p);
  }
  return out;
}

function blockName(line) {
  const m = line.match(ANCHOR_RE);
  if (!m) return null;
  if (m[1]) return m[1]; // function name
  if (m[2]) return m[2]; // const name
  if (m[3] && m[4]) return `${m[3]}.${m[4]}`; // route signature
  return null;
}

function scanFile(absPath) {
  const rel = relative(ROOT, absPath).split(sep).join("/");
  if (ALLOWED_FILES.has(rel)) return [];
  const lines = readFileSync(absPath, "utf8").split(/\r?\n/);

  /* Découpe en blocs : un bloc commence à une ancre racine et finit à la prochaine
     ancre racine (ou EOF). Tout ce qui précède la 1re ancre (imports, types) est
     ignoré car sans requête DB. */
  const blocks = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) {
      const name = blockName(line);
      if (name) {
        cur = { name, start: i, lines: [] };
        blocks.push(cur);
      }
    }
    if (cur) cur.lines.push({ idx: i, text: line });
  }

    const violations = [];
    for (const b of blocks) {
      if (ALLOWED_BLOCKS.has(b.name)) continue;
      const body = b.lines.map((l) => l.text).join("\n");
      const hasRadioId = /\bradioId\b|\bradio_id\b/i.test(body);
      if (hasRadioId) continue;

      /* Cherche les requêtes tenant dans le bloc :
         - accès Drizzle (db.select/delete/update/insert, db.query.X, .from/.join) ;
         - SQL brut dans un template taggé `sql`...`` (multiligne géré). */
      const hits = [];
      for (const l of b.lines) {
        if (DRIZZLE_RE.test(l.text)) hits.push({ line: l.idx + 1, text: l.text.trim() });
      }
      let inSql = false;
      let sqlText = "";
      let sqlStartLine = 0;
      for (const l of b.lines) {
        if (!inSql) {
          const idx = l.text.indexOf("sql`");
          if (idx >= 0) {
            const after = l.text.slice(idx + 4);
            const close = after.indexOf("`");
            if (close >= 0) {
              if (RAW_SQL_RE.test(after.slice(0, close)))
                hits.push({ line: l.idx + 1, text: "sql`...`" });
            } else {
              inSql = true;
              sqlStartLine = l.idx + 1;
              sqlText = after;
            }
          }
        } else {
          const close = l.text.indexOf("`");
          if (close >= 0) {
            sqlText += "\n" + l.text.slice(0, close);
            if (RAW_SQL_RE.test(sqlText)) hits.push({ line: sqlStartLine, text: "sql`...`" });
            inSql = false;
            sqlText = "";
          } else {
            sqlText += "\n" + l.text;
          }
        }
      }
      if (hits.length === 0) continue;

      violations.push({
        file: rel,
        block: b.name,
        startLine: b.start + 1,
        hits,
      });
    }
    return violations;
}

function main() {
  const files = SCAN_DIRS.flatMap(listTsFiles).sort();
  let total = 0;
  const all = [];
  for (const f of files) {
    const v = scanFile(f);
    if (v.length) {
      total += v.length;
      all.push(...v);
    }
  }

  if (total === 0) {
    console.log(`[tenant-guard] ✓ aucun accès tenant sans radioId sur ${files.length} fichiers.`);
    return 0;
  }

  console.error(`[tenant-guard] ✗ ${total} bloc(s) avec accès tenant sans radioId :\n`);
  for (const v of all) {
    console.error(`  ${v.file} — bloc « ${v.block} » (ligne ${v.startLine}) :`);
    for (const h of v.hits) console.error(`    L${h.line}: ${h.text.slice(0, 160)}`);
    console.error("");
  }
  console.error(
    "[tenant-guard] Si c'est un faux positif légitime (cross-radio par conception, lookup par PK), " +
      "documenter le cas dans ALLOWED_FILES / ALLOWED_BLOCKS de api/scripts/check-tenant-queries.mjs.",
  );
  return 1;
}

const code = main();
process.exit(code);
