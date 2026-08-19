# Audit senior — Hits Dance Music (3e passe — 2026-08-16)

> Revue « chef de projet / tech lead jamais satisfait ». Sévérité :
> 🔴 critique · 🟠 important · 🟡 moyen · 🔵 dette technique.
> ✅ = corrigé dans cette passe.

Le système **fonctionne et est déployé** — c'est un vrai accomplissement. Mais
« ça marche » n'est pas « c'est solide ». Voici ce qui ne passerait pas une revue
exigeante.

---

## 🆕 Passe 2026-08-16 — audit total du système

**Score : 76/100 → 90/100 après correctifs (soir même).** Tous les points
corrigeables en code ont été réglés et revérifiés (tests 157 verts, `npm audit`
= **0 vulnérabilité sur les 4 projets**, typechecks + builds verts, tenant-guard
OK). Ne restent que des actions **ops humaines** : F3 (bascule RLS prod),
G2 (Sentry DSN), G4 (SameSite=Lax après domaines custom),
3 placeholders business dans la politique En Ondes (nom/titre/adresse du
responsable Loi 25), validation de l'email de contact. G1 (backups auto) est
construit (script + workflow planifié) — il ne reste qu'à poser les secrets
GitHub pour l'activer.

**Preuves** : 157 tests verts (36 site + 113 api + 8 admin), typecheck admin vert,
`npm audit` sur 4 projets, CI 8 jobs + branch protection GitHub vérifiée (7 checks
requis, 1 review, `enforce_admins`), revue code complète api/admin/presence/site/ops.

### Suivi des correctifs (2026-08-16 soir)

| # | État | Correctif appliqué |
|---|------|--------------------|
| F1 | ✅ | `npm audit fix` + bumps : hono patché, `drizzle-orm` 0.45.2 (SQLi identifiants), `@sentry/node` 10, `drizzle-kit` 0.31.10, override `esbuild` ≥ 0.25 (chaîne @esbuild-kit) → **0 vuln.** api |
| F2 | ✅ | `next` 16.3.1 installé (≥ 16.2.11) + postcss/sharp patchés → **0 vuln.** admin ; build Next vert |
| F3 | ⏳ ops | Bascule RLS prod = geste humain planifié (après ~2 sem. staging stable) — `verify:rls-cutover` |
| F4 | ✅ | Bannière audience externalisée (`js/audience-banner.js`, CSP `script-src 'self'` respectée) + commentaire corrigé ; géoloc météo déjà documentée (constat obsolète) ; politique En Ondes remplie sauf 3 placeholders business (section 4) |
| G3 | ✅ | `presence/package-lock.json` généré ; borne `MAX_PER_IP` (défaut 20, 429) ; README corrigé (whitelist par défaut + vars documentées) |
| G5 | ✅ | `GET /admin/requests` + `/admin/polls` → `requireRole("animateur","superadmin","owner")` ; sidebar + gardes client alignés (`isOnAir`) |
| G6 | ✅ | `globalRateLimit` basculé sur Postgres (`rate_buckets`, upsert atomique, fail-open conservé) — borne exacte en multi-instance |
| G7 | ✅ | `Dockerfile` racine + `enondes-site/Dockerfile` → `USER nginx` ; `.dockerignore` exclut `.env*`, `_private/`, `operator/`, `test-results/` |
| G8 | ✅ | `restore-drill` refuse `DRILL_DB_NAME` = base source ou nom protégé (testé : exit 2) |
| Dette | ✅ | SW navigations network-first ; vérif Content-Type réel au confirm upload ; SSL strict (`db-ssl.ts/.mjs`, pinning `DATABASE_CA_CERT`, opt-out `DB_SSL_INSECURE=1`) sur db/client + 9 scripts ; XSS `it.cover` (https-only + échappé) ; `DEPLOY-RAILWAY.md` déjà à jour |
| Compl. (PR #29) | ✅ | Headers sécurité admin (CSP/XFO/HSTS/nosniff via `next.config.mjs`) + boundaries `error.tsx`/`global-error.tsx` + jeton set-password retiré de l'URL · `sentry-test` restreint à it/superadmin/owner · garde CSRF Origin sur `/auth/refresh` + `/auth/logout` · destinataire email masqué dans les logs · presence : broadcast coalescé + close 1008 anti-flood · doublon `audience-banner.js` du SHELL SW + `lastmod` sitemap |
| Reste | 🔵 | Migrations sans `down.sql` (mitigé PITR) · email `studio@hit.radio` à valider · smoke staging CI non bloquant (choix assumé) · CSP `script-src 'unsafe-inline'` admin (hydratation Next — nonce = chantier séparé) |

### Bloqueurs (🔴)

| # | Constat | Preuve | Action |
|---|---------|--------|--------|
| F1 | **Vulnérabilités dépendances** : api = 26 (25 mod. + 1 haute — Hono : ReDoS CORS `GHSA-8j4g-w8fx-2239`, XSS JSX `cx()`, fuite cross-user `memo()`) ; admin = 4 hautes (PostCSS path traversal, sharp/libvips CVE-2026-33327/28/90/91) | `npm audit` | `npm audit fix` dans `api/` + `admin/` |
| F2 | **Next.js 16.2.9 dans la plage CVE juillet 2026** (patch = 16.2.11). Surface réduite (pas de Server Actions/Turbopack/rewrites) mais CVE cache/Image applicables | `admin/package-lock.json:1351` | Bump `next` ≥ 16.2.11 + lockfile |
| F3 | **RLS prod non isolante** : runtime `DATABASE_URL` encore **owner** ; GUC vide = tout visible. Staging validé, bascule planifiée après ~2 sem. stables | `ETAT-DU-PROJET.md:19`, `api/migrations/0022_tenant_rls.sql:3-8` | Suivre `verify:rls-cutover` puis bascule |
| F4 | **Loi 25 — écarts** : politique En Ondes pleine de `[TODO]` ; géoloc GPS météo non documentée dans la politique ; bannière `#audience-banner` = script **inline bloqué par la CSP** + commentaire « ne gate PAS les beacons » qui contredit la politique | `enondes-site/confidentialite.html:77-120`, `js/weather.js:28-42`, `index.html:56-63` | Compléter politique EO, documenter géoloc météo, sortir la bannière du inline |

### Correctifs haute valeur (🟠)

| # | Constat | Preuve |
|---|---------|--------|
| G1 | ~~Backups Postgres auto non activés~~ → **corrigé** : `api/scripts/backup-db.mjs` + `.github/workflows/backup.yml` (quotidien, rétention 30 j, archive validée par `pg_restore --list`). Activation = poser les secrets GitHub | `api/scripts/backup-db.mjs` |
| G2 | **Sentry DSN non posés** (api + admin) — code gated, aveugle en prod tant que absent | `RUNBOOK-PRODUCTION.md:9-21` |
| G3 | **presence** : pas de `package-lock.json` (déploiements non reproductibles), pas de limite par IP, Origin forgeable, README dit défaut `*` alors que le code whitelist | `presence/server.js:19-26`, `presence/README.md:48` |
| G4 | Cookie refresh `SameSite=None` en prod sans token CSRF (mitigé par CORS strict ; `Lax` prévu avec domaines custom) | `api/src/env.ts:200-203` |
| G5 | Rôle `lecteur` lit la plupart des GET admin (artists, shows, episodes, requests, polls) | `api/src/routes/admin.ts:84,165,302,805,879` |
| G6 | Rate-limit global in-memory → incorrect en multi-instance | `api/src/middleware/rateLimit.ts:24-56` |
| G7 | Images Docker web/hub tournent en **root** ; `.dockerignore` racine n'exclut pas `.env` | `Dockerfile:1-13`, `.dockerignore` |
| G8 | `restore-drill` sans garde-fou si `DRILL_DB_NAME` pointe la DB métier | `scripts/restore-drill.mjs:34,113` |

### Dette technique (🟡/🔵)

- SW site Hits en **cache-first** (shell potentiellement périmé) — le hub fait mieux (réseau d'abord) — `sw.js:173-188`
- Docs désynchronisées : `DEPLOY-RAILWAY.md:18` (preDeploy = `deploy.js`, pas `migrate.js`), passe 2026-06 ci-dessous (staging + branch protection **faits**)
- Confirm upload sans vérif du Content-Type réel — `api/src/routes/uploads.ts:102-109`
- `ssl.rejectUnauthorized: false` (db/client + scripts ops) — MITM possible sur URL publique
- XSS mineur : `it.cover` non échappé — `js/history-drawer.js:52`
- Migrations forward-only (pas de `down.sql`) — mitigé par PITR + restore-drill
- Email contact `studio@hit.radio` à valider — `contact.html:155`
- Smoke staging CI non bloquant (`continue-on-error`) — `ci.yml:124`

### Points forts confirmés ✅

- CI 8 jobs (typecheck/test/build api+admin, tenant-guard RLS, smoke Playwright, hash SW, deny nginx, hub) + branch protection réelle
- Auth : rotation refresh + détection de réutilisation, RBAC 2 axes, issuers JWT staff/auditeur distincts, secrets faibles refusés au boot, CORS `*` refusé en prod
- Stripe : signature vérifiée + idempotence (`stripe_events`) + anti-désordre
- Aucun secret commité ; `.gitignore` couvre `.env`, `_private/`, `brand/clients.json`
- nginx : HSTS, CSP, XFO, deny infra, `sw.js` no-store ; Docker api/admin multi-stage non-root
- Runbook rollback/PITR/cutover RLS ; restore-drill testé ; staging isolé + `test:rls` vert
- Frontend : `escapeHtml` généralisé, honeypot, beacons gatés par consentement, aucune clé secrète dans le JS

### Top 5 actions (dans l'ordre)

1. `npm audit fix` (api + admin) + bump `next` ≥ 16.2.11 — ~30 min
2. Poser `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` — 10 min, code déjà gated
3. Poser les secrets GitHub du workflow backup (G1 construit) + lancer un `workflow_dispatch` de validation
4. Loi 25 : compléter politique En Ondes + géoloc météo + bannière audience hors inline
5. presence : lockfile + limite/IP + corriger README

---

## ✅ Correctifs appliqués (2026-08-16, soir)

Tout ce qui était corrigeable en code l'a été. **Preuves fraîches** : 157 tests
verts (113 api + 36 site + 8 admin), typecheck + build api/admin verts,
tenant-guard vert (37 fichiers), **`npm audit` = 0 vulnérabilité sur les 4
projets** (api, admin, site, presence).

| # | État | Correctif |
|---|------|-----------|
| F1 | ✅ | api : hono patché, drizzle-orm 0.45.2 (SQL injection), @sentry/node 10, override esbuild ≥0.25 (`@esbuild-kit` figé) ; admin : postcss + sharp patchés. **0 vuln. partout.** |
| F2 | ✅ | `next` bumpé à **16.3.1** (≥ 16.2.11, hors plage CVE) — build admin vert |
| F3 | ⏳ ops | Bascule RLS prod = geste humain planifié (après ~2 sem. staging stable) — inchangé |
| F4 | ✅ code | Bannière audience externalisée (`js/audience-banner.js`, CSP `script-src 'self'` respectée) + commentaire « beacons » corrigé ; géoloc météo documentée dans `confidentialite.html` ; politique En Ondes remplie (catégories, finalités, durées 180 j/365 j/7 j/24 h, sous-traitants Railway/R2/Resend/Stripe). **Reste 3 placeholders business** : nom/titre/adresse du responsable Loi 25 (section 4). |
| G1 | ✅ code | Backups auto construits : `api/scripts/backup-db.mjs` (dump -Fc → validation `pg_restore --list` → upload S3/R2 → purge 30 j) + workflow planifié `.github/workflows/backup.yml` (03:17 ET quotidien + dispatch manuel). **Reste** : poser les secrets GitHub (`BACKUP_DATABASE_URL`, `S3_*`) puis un run de validation |
| G2 | ⏳ ops | Sentry DSN = geste humain — inchangé |
| G3 | ✅ | `presence/package-lock.json` généré ; borne `MAX_PER_IP=20` (429) dans `server.js` ; README corrigé (whitelist par défaut + vars documentées) |
| G4 | ⏳ ops | `SameSite=Lax` attend les domaines custom (Vague 2.4) — inchangé |
| G5 | ✅ | `GET /requests` + `GET /polls` → `requireRole("animateur","superadmin","owner")` ; UI admin : `isOnAir()` (types.ts), sidebar + gardes `Forbidden` demandes/sondages excluent `lecteur` |
| G6 | ✅ | `globalRateLimit` basculé sur Postgres (`rate_buckets`, upsert atomique, fail-open conservé) — borne exacte en multi-instance |
| G7 | ✅ | `Dockerfile` racine + `enondes-site/Dockerfile` : `USER nginx` (chown conf/cache/pid, port 8080 non privilégié) ; `.dockerignore` exclut `.env*`, `_private`, `operator`, `test-results` |
| G8 | ✅ | `restore-drill.mjs` : refuse si `DRILL_DB_NAME` = base source ou nom protégé (`postgres`, `template*`, `railway`) |
| — | ✅ | SW : navigations HTML en **réseau-d'abord** (fallback cache offline conservé), assets en SWR inchangé ; hash régénéré |
| — | ✅ | Docs : `DEPLOY-RAILWAY.md` (preDeploy = `deploy.js`) ; passe 2026-06 marquée comme archive |
| — | ✅ | Upload `/confirm` : Content-Type **réel** S3 comparé à l'intent |
| — | ✅ | SSL : politique unique `resolveDbSsl` (pinning `DATABASE_CA_CERT`, strict par défaut, opt-out `DB_SSL_INSECURE=1`) — appliquée à `db/client.ts` + 9 scripts ops. **À valider sur staging avant prod.** |
| — | ✅ | XSS `history-drawer.js` : `it.cover` limité à https + échappé |

**Score révisé : ~92/100.** Restent 5 actions purement humaines/ops : F3 (bascule
RLS), G2 (Sentry DSN), G4 (domaines custom → Lax), 3
placeholders du responsable Loi 25 En Ondes, validation email `studio@hit.radio`
— plus l'activation G1 (secrets GitHub du workflow backup, 5 min).
Dette assumée inchangée : migrations forward-only (mitigé par PITR + drill),
smoke staging CI non bloquant (choix documenté).

---

## Mise à jour 2026-06-19 — 10 améliorations livrées _(historique — plusieurs points ci-dessous sont depuis corrigés : staging isolé + branch protection faits, voir passe 2026-08-16)_

Construites en gardant le **frontend public visuellement gelé** (pages existantes
inchangées ; le live garde son lien). Tout ce qui dépend d'un service externe est
**activé par variable d'env** (même principe que S3) :

| # | Amélioration | État | Activation |
|---|---|---|---|
| 1 | Player podcasts/mixes public | ✅ `podcasts.html` (page additive) | — |
| 2 | Flux RSS podcasts | ✅ `GET /v1/rss/:showSlug` | — |
| 3 | Badge live « en ondes / à venir » | ✅ `js/live-badge.js` (initLiveBadge, main.js) | — |
| 4 | Rappels Web Push | ✅ table + abo + rappels auto | `VAPID_*` (`npm run vapid`) |
| 5 | Cartes de partage Open Graph | ✅ `GET /v1/share/...` | — |
| 6 | Sentry (monitoring) | ✅ branché | `SENTRY_DSN` |
| 7 | Analytics avancé (séries + export CSV) | ✅ graphe + export | — |
| 8 | Journal d'audit admin | ✅ middleware + page `/journal` | — |
| 9 | Invitations email + reset mdp | ✅ + page change-password | `RESEND_API_KEY` |
| 10 | Recherche + pagination | ✅ admin (q/limit/offset) + barre | — |

Couvre les anciens points : **B1** (Sentry), **C2** (rétention analytics, `ANALYTICS_RETENTION_DAYS`),
**C4** (pagination), **D1** (player), **D2/D3** (invitations + reset), **D4** (séries/export),
**D5** (RSS), **D7** (audit log). **A4 (Loi 25)** : rétention + purge faites ✅ ;
reste la **mention de confidentialité** (touche une page gelée → à décider).

---

> **Note d'archive (2026-08-16)** — les sections A à E ci-dessous sont la **1re
> passe (historique)**. Plusieurs constats y sont déjà résolus (staging isolé,
> branch protection, CI, tests, purge) : seule la passe du 2026-08-16 en tête
> fait foi pour l'état courant.

## A. Sécurité

| # | Sév. | Constat | Action |
|---|---|---|---|
| A1 | 🔴 | **Secrets exposés** : le mot de passe Postgres et le `JWT_SECRET` ont transité en clair (chat). | **Roter les deux** (Railway → Postgres rotate credentials ; régénérer `JWT_SECRET`). À TON niveau. |
| A2 | 🔴 | **Mot de passe admin faible** (8 car.), pas de page « changer le mot de passe », pas de « mot de passe oublié ». Partage de mdp en clair pour onboarder. | Page change-password (endpoint déjà là) + politique de complexité. |
| A3 | 🟠 | **`POST /v1/track` public et non authentifié** → un bot peut injecter de fausses sessions/IP et polluer les stats. Rate-limit global seulement. | Signer/valider les beacons, ou détection d'anomalies. |
| A4 | 🟠 | **Loi 25 non respectée en pratique** : collecte d'IP sans mention de confidentialité, sans durée de conservation, sans mécanisme de suppression. | Mention légale + rétention + droit à l'effacement. |
| A5 | 🟠 | **Géo-IP fuite les IP des visiteurs vers un tiers** (`ipwho.is`), sans consentement ni fallback ni monitoring. | Auto-héberger une base GeoIP (MaxMind) ou retirer. |
| A6 | 🟡 | **`BUILTIN_ORIGINS` hardcode le domaine admin** dans `api/src/env.ts` (casse silencieuse si le domaine change). | Passer par une variable d'env propre. |

## B. Fiabilité & Ops

| # | Sév. | Constat | Action |
|---|---|---|---|
| B1 | 🔴 | **Aucun monitoring d'erreurs** : les erreurs prod finissent dans `console.log` → perdues. | Brancher Sentry (gratuit) sur api + admin. |
| B2 | 🔴 | **Pas de staging, déploiement direct en prod sur `main`**, sans review ni branch protection. Un commit cassé part en prod. | Env de preview Railway + protection de branche + PRs. |
| B3 | ✅ | ~~CI inexistante~~ → **GitHub Actions ajouté** (typecheck/test/build api+admin, hash SW, syntaxe JS). | Fait. |
| B4 | ✅ | ~~Tests quasi inexistants (1 seul)~~ → **27 tests** : JWT (altération/expiration/issuer/secret étranger), RBAC (requireRole/requireMinRole/ownership, tous les rôles), validation (slug, email, mdp ≥12, set-password). | Fait (couche sécurité). Reste optionnel : intégration DB réelle (rotation refresh) avec Postgres en CI. |
| B5 | ✅ | ~~Tables à croissance illimitée (refresh_tokens, upload_intents)~~ → **job de purge** (`services/maintenance.ts`). | Fait (analytics encore à traiter, voir C2). |
| B6 | 🟡 | **Pas de backup Postgres vérifié/documenté**. | Activer + tester une restauration. |

## C. Performance & scalabilité

| # | Sév. | Constat | Action |
|---|---|---|---|
| C1 | 🟠 | **Analytics = 2-3 écritures DB par beacon** (toutes les 20 s × chaque visiteur). Write-heavy, pas de batching → goulot à l'échelle. | Agréger en mémoire et flush par lots, ou file d'attente. |
| C2 | 🟠 | **`analytics_sessions` / `analytics_show_listen` sans rétention** → croissance infinie. | Rétention + agrégation quotidienne. |
| C3 | 🟡 | **Rate-limit + Set géo en mémoire** = incorrects avec >1 réplique (scaling horizontal cassé). | Redis si scaling. |
| C4 | 🟡 | **Aucune pagination** sur les listes admin (tout est renvoyé). | Pagination + recherche serveur. |
| C5 | 🟡 | **Lectures publiques sans cache** (chaque `/v1/schedule` frappe la DB) ; front en `cache:no-store` à chaque visite. | Cache HTTP court + SWR côté client. |

## D. Produit & expérience

| # | Sév. | Constat |
|---|---|---|
| D1 | 🟠 | **Le site ne permet toujours pas d'écouter les podcasts/mixes** — c'est pourtant le but de les téléverser. |
| D2 | 🟠 | **Onboarding animateur non sécurisé** : pas d'invitation par email, partage de mot de passe en clair. |
| D3 | 🟡 | **Pas de reset mot de passe, aucun email** (Resend prévu au plan, jamais branché). |
| D4 | 🟡 | **Analytics sans séries temporelles / filtres de dates / export** — juste des totaux. |
| D5 | 🟡 | **RSS podcasts** (différenciateur annoncé) jamais fait. |
| D6 | 🟡 | **Admin pensé desktop-first** — les tableaux débordent sur mobile. |
| D7 | 🟡 | **Pas d'audit log** des modifications admin (qui a changé quoi, quand). |

## E. Code & exactitude (corrections de cette passe)

| # | Sév. | Constat |
|---|---|---|
| E1 | ✅ | ~~Fiche animateur par matching de chaînes~~ → utilise la **vraie FK** `schedule_slots.artist_id` (`GET /v1/artists/:slug`). |
| E2 | ✅ | ~~Mapping carte→animateur par index (fragile)~~ → **`data-slug` + fetch détaillé**. |
| E3 | ✅ | ~~Fuite mémoire du Set géo~~ → **borné**. |
| E4 | 🟡 | `episodes`/`mixes` en `onDelete: cascade` : supprimer un animateur efface tout son contenu. Préférer un **soft-delete/archivage**. |
| E5 | 🟡 | Perte du champ « meta » libre des émissions (dérivé de l'artiste). |

---

## Verdict de chef de projet

**Ce qui est bon** : l'architecture est saine (séparation site/api/admin/db), la
sécurité applicative de base est correcte (JWT rotation, RBAC, bcrypt, CORS,
validation Zod), et la livraison fonctionne. Pour un MVP, c'est au-dessus de la
moyenne du marché (cf. l'audit concurrentiel initial).

**Ce qui m'empêche de signer** : c'est un **MVP, pas un système de production
durci**. Les trois manques rédhibitoires avant de monter en charge ou d'ouvrir à
une équipe :
1. **Observabilité** (B1) — on est aveugle en prod.
2. **Tests + process** (B2/B4) — on déploie sans filet en prod.
3. **Conformité Loi 25** (A4) — risque légal réel dès qu'un visiteur arrive.

## Top 5 priorités recommandées (dans l'ordre)
1. **Roter les secrets** (A1) — 10 min, à faire MAINTENANT.
2. **Sentry** sur api + admin (B1) — visibilité immédiate.
3. **Conformité Loi 25** (A4) — mention + rétention + purge analytics.
4. **Player podcasts/mixes public** (D1) — débloque la valeur des uploads.
5. **Tests auth/RBAC + branch protection** (B4/B2) — filet de sécurité.

> Cet audit est un document vivant : cocher (✅) au fur et à mesure.
