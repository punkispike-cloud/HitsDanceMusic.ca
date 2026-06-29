# Hits Dance Music — API

Backend de la plateforme radio : authentification, gestion de contenu
(animateurs, émissions, grille horaire, podcasts, mixes) et uploads audio S3.
Construit en **Hono + Drizzle + PostgreSQL** (TypeScript, Node 20, ES modules).

> Le frontend public reste **gelé** : cette API est déployée à côté et ne
> modifie rien du site existant. Le branchement du site sur l'API est une
> phase ultérieure.

## Stack

| Couche | Choix |
|---|---|
| Framework HTTP | Hono + `@hono/node-server` |
| ORM / migrations | Drizzle ORM + drizzle-kit |
| Base de données | PostgreSQL (plugin Railway) |
| Auth | JWT access (jose, HS256) + refresh opaque haché (rotation) |
| Mots de passe | bcryptjs (coût 12) |
| Validation | Zod |
| Stockage audio | S3 (upload pré-signé direct) |

## Déploiement Railway

1. **PostgreSQL** : dans le projet Railway, **+ New → Database → PostgreSQL**.
2. **Service API** : **+ New → GitHub Repo → HitsDanceMusic.ca**, puis
   **Settings → Source** :
   - **Root Directory** : `api`
   - **Builder** : Dockerfile (auto-détecté)
3. **Variables** (cf. `.env.example`) :
   - `DATABASE_URL` = référence `${{Postgres.DATABASE_URL}}` (URL privée)
   - `JWT_SECRET` = `openssl rand -base64 48`
   - `ALLOWED_ORIGINS` = tous les domaines qui parlent à l'API (site public + admin + hub), ex. `https://hitsdancemusic.ca,https://www.hitsdancemusic.ca,https://admin.hitsdancemusic.ca` (CORS — aucune origine hardcodée, cf. § Sécurité)
   - `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (premier superadmin)
   - `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` (compte En Ondes — rôle `owner`, god mode cross-radio)
   - `SEED_IT_EMAIL` / `SEED_IT_PASSWORD` / `SEED_IT_NAME` (compte IT — rôle `it`, monitoring technique cross-radio, sans accès éditorial/commercial ; optionnel)
   - (Phase 4) `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`
4. **Migrations** : lancer une fois `npm run db:migrate` (Railway → `railway run`
   ou commande release). Puis `npm run seed` pour importer animateurs/émissions/grille.
5. **Settings → Networking → Generate Domain** → idéalement domaine custom
   `api.hitsdancemusic.ca` (cookie refresh propre, même domaine parent que l'admin).

## Développement local

```bash
cd api
cp .env.example .env          # ajuster DATABASE_URL + JWT_SECRET
npm install
npm run db:migrate            # applique les migrations
npm run seed                  # superadmin + animateurs + émissions + grille
npm run dev                   # http://localhost:8082
```

Un Postgres local rapide (Docker) :
```bash
docker run -d --name hr-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
```

## Endpoints

### Public (sans token)
- `GET /health` → `{ ok, db }`
- `GET /v1/schedule` → grille au format exact `SCHEDULE` (`{ "0": [[from,to,title,host,tag]], ... }`)
- `GET /v1/schedule/now` → créneau courant (heure Montréal)
- `GET /v1/artists` · `/v1/artists/:slug` · `GET /v1/shows` · `/v1/shows/:slug`
- `GET /v1/episodes` · `/v1/episodes/:slug` · `GET /v1/mixes` · `/v1/mixes/:slug`
- `GET /v1/tracks/recent` · `POST /v1/tracks/:id/like` · `DELETE /v1/tracks/:id/like` (🤘 anonyme par `clientId`)
- `POST /v1/track` → beacon analytics (pageview/heartbeat/listen ; IP captée côté serveur)
- `GET /v1/push/vapid-public-key` · `POST /v1/push/subscribe` (Web Push public)
- `GET /v1/rss/:showSlug` · `GET /v1/share/…` (aperçus de partage)

### Auth (`/auth/*` — rate-limit strict anti brute-force)
- `POST /auth/login` → `{ accessToken, user }` (+ cookie refresh httpOnly)
- `POST /auth/refresh` → rotation, nouvelle paire
- `POST /auth/logout` · `GET /auth/me` · `POST /auth/change-password`
- `POST /auth/forgot-password` · `POST /auth/set-password` (jeton invite/reset à usage unique)

> La création de comptes équipe passe par `POST /v1/admin/users` (scopé radio) —
> pas de `/auth/register` séparé (il créait des comptes hors-tenant, `radio_id` NULL).

### CRUD éditorial (`/v1/admin/*` — `requireAuth` + `adminTenant` + audit)
Mur multi-tenant : une seule radio. Lecture : tout authentifié. Écriture :
`requireEditorialAdmin` (superadmin + owner) ou animateur **propriétaire**
(`requireOwnershipOrAdmin`, ownership via `artist_id`). `it` est EXCLU.
- `artists`, `shows`, `schedule-slots` (grille), `episodes` (podcasts), `mixes` — CRUD
- `users` — gestion des comptes de la radio (`requireEditorialAdmin` + anti-escalade de rang)
- `uploads/presign` + `uploads/confirm` — flux S3 pré-signé (Phase 4)

### Owner/IT — technique cross-radio (`requireItOrOwner`, console `/v1/owner/*`)
Pas de scoping single-radio : le parc entier. `owner` + `it` y accèdent.
- `GET /v1/owner/overview` · `/v1/owner/radios` · `/v1/owner/health` · `/v1/owner/alerts`
- `GET /v1/owner/timeseries` · `/v1/owner/radios/:id/report`
- `GET /v1/admin/audit` — journal d'audit (`superadmin` + `it` + `owner`)
- `POST /v1/admin/push/notify` — diffusion manuelle (`superadmin` + `it` + `owner`)
- `GET /v1/admin/analytics/{overview,shows,timeseries,geo,breakdown}` — KPIs agrégés (sans IP)
- `GET /v1/admin/tracks/recent` — historique des titres passés à l'antenne

> Les jobs récurrents (maintenance, monitoring, rappels, rapports mensuels,
> track-history) tournent en **arrière-plan**, coordonnés par un verrou distribué
> (cf. § Sécurité) — ce ne sont pas des endpoints HTTP.

### Owner — commercial (`requireOwner`, `/v1/owner/*`)
Réservé au propriétaire En Ondes (god mode). `it` ne peut ni créer ni modifier une radio.
- `POST /v1/owner/radios` — création/provisioning d'un tenant (statut `provisioning`)
- `PATCH /v1/owner/radios/:id` — statut, flux, forfait, billing

### Analytics exposant des IP → `requireRole("superadmin", "owner")`
`it` en est EXCLU (sessions/exports contiennent des IP — donnée personnelle, Loi 25).
- `GET /v1/admin/analytics/sessions` · `GET /v1/admin/analytics/export?type=sessions|shows`

## Rôles & RBAC

Cinq rôles (enum `user_role` dans `api/src/db/schema.ts`, helpers dans
`api/src/middleware/rbac.ts`). Deux axes de capacité + un rang linéaire
(anti-escalade/gestion uniquement — il ne dit rien des capacités) :

| Rôle | Scope | Éditorial | Technique cross-radio | Commercial (parc/billing) |
|---|---|---|---|---|
| `owner` | cross-radio | oui | oui | oui (god mode) |
| `it` | cross-radio | non | oui (monitoring parc) | non |
| `superadmin` | 1 radio | oui | non | non |
| `animateur` | 1 radio (son contenu) | son contenu | non | non |
| `lecteur` | 1 radio | lecture | non | non |

- `owner` = En Ondes (opérateur de la plateforme) ; `superadmin` = admin d'une radio cliente.
- `it` (IT) accède au monitoring technique du parc (santé, alertes, journal, stats) **sans** éditer le contenu ni toucher au billing.
- **Axe éditorial** — `isEditorialAdmin(role)` = `superadmin` || `owner` (gère le contenu, court-circuite l'ownership). EXCLUT `it`. `requireEditorialAdmin` protège le CRUD contenu.
- **Axe cross-radio** — `isCrossRadio(role)` = `owner` || `it` (parc / technique). EXCLUT `superadmin`. `requireItOrOwner` protège la console `/v1/owner/*` technique ; `requireOwner` protège le commercial.
- **Rang linéaire** — `RANK = { lecteur:1, animateur:2, superadmin:3, it:4, owner:5 }`. Sert uniquement à l'anti-escalade : `assertCanAssignRole` / `assertCanManageUser` refusent qu'un acteur attribue ou gère un rôle de rang supérieur au sien (un `superadmin` ne peut pas créer/promouvoir un `owner`).
- Écriture éditoriale : `superadmin` + `owner` (`requireEditorialAdmin`), ou animateur **propriétaire** (`requireOwnershipOrAdmin`, ownership via `artist_id`). `it` est exclu.

## Seed & variables d'environnement

Le seed (`api/src/db/seed.ts`, idempotent — joué à chaque déploiement) provisionne
les comptes selon les variables lues dans `api/src/env.ts`. Création s'il manque,
**promotion** s'il existe (jamais d'écrasement de contenu) :

- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` — premier `superadmin` de la radio
  (`radioId` = la radio de l'instance). Créé seulement s'il est absent.
- `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` — compte **owner** En Ondes (god mode
  cross-radio, `radioId` NULL). S'il existe déjà, il est **promu** `owner` (ainsi un
  ancien `superadmin` devient owner sans SQL manuel) — jamais rétrogradé.
- `SEED_IT_EMAIL` / `SEED_IT_PASSWORD` / `SEED_IT_NAME` (défaut « Équipe IT ») —
  compte **it** (technique cross-radio, `radioId` NULL, sans accès éditorial/commercial).
  Miroir du owner : promotion en `it` si le compte existe, **sauf** s'il est déjà
  `owner` (laissé owner — on ne rétrograde jamais un owner). Optionnel.
- `SEED_BRAND` (défaut `hitsdance`) — marque/tenant de l'instance ; tout autre slug =
  contenu vierge à saisir via l'admin. `SEED_RADIO_NAME` optionnel (nom affiché).

> Les comptes cross-radio (`owner`, `it`) ont `radio_id` NULL ; ils choisissent la
> radio via `X-Radio-Id` / `?radio=` (cf. § Sécurité — isolement tenant).

## Sécurité

- Access JWT court (15 min) ; refresh opaque 30 j **haché** en DB (rotation +
  détection de réutilisation → révocation de chaîne).
- bcrypt coût 12 ; jamais de mot de passe loggé/renvoyé.
- **CORS** : whitelist via la variable d'env `ALLOWED_ORIGINS` **uniquement**
  (aucune origine hardcodée — C1.4). En prod, ops DOIT y lister **tous** les
  domaines qui parlent à l'API : le **site public**, l'**admin** et le **hub**,
  séparés par des virgules, domaines exacts (pas de wildcard) :
  `ALLOWED_ORIGINS=https://hitsdancemusic.ca,https://www.hitsdancemusic.ca,https://admin.hitsdancemusic.ca,https://<admin-railway>.up.railway.app`.
  Si la variable est vide, **aucune** origine navigateur n'est autorisée (CORS
  bloque tout) → le service n'est plus qu'attaquable en non-navigateur. À
  vérifier au déploiement.
- **Rate-limit** : global en mémoire (par instance) + **strict sur `/auth/*`
  anti brute-force, Postgres-backed** (table `rate_buckets`, partagé entre
  instances). Fail-open en cas d'indisponibilité DB (l'auth reste disponible).
- **Isolement tenant** : sans RLS Postgres native, l'isolation repose sur
  `radio_id` posé par les middlewares `publicTenant`/`adminTenant` et passé à
  chaque requête. `publicTenant` déduit la radio de l'hôte HTTP ; `adminTenant`
  scopé à la radio de l'utilisateur pour `superadmin`/`animateur`/`lecteur`, tandis
  que les comptes cross-radio (`owner`/`it`) sélectionnent la radio via le header
  `X-Radio-Id` (ou `?radio=`). Une **garde statique en CI** (`npm run tenant:guard`
  → `api/scripts/check-tenant-queries.mjs`) rejette tout accès à une table tenant
  sans référence à `radioId` dans le même bloc (routes + services). Faux positifs
  cross-radio légitimes documentés dans le script (console owner, auth, jobs
  globaux, loaders d'ownership).
- **Verrou distribué** : les jobs récurrents (maintenance, monitoring, rappels,
  rapports mensuels, track-history) se coordonnent via `pg_try_advisory_lock`
  (`api/src/services/lock.ts`) — en multi-instance Railway, une seule instance
  exécute un tick donné (skip silencieux sinon). Pas de table/migration : les
  advisory locks vivent en mémoire Postgres.
- Zod sur tous les bodies, cap taille body, mime whitelist sur uploads.
- Injection SQL éliminée par Drizzle (requêtes paramétrées).
- Fail-fast au boot si `JWT_SECRET`/`DATABASE_URL` manquants ou faibles.

## Vérification

```bash
npm run build      # typecheck strict
npm test           # round-trip grille (SCHEDULE ↔ minutes, couverture 24h)
```

Smoke test live (après migrate + seed + dev) :
```bash
curl localhost:8082/health
curl localhost:8082/v1/schedule          # doit refléter SCHEDULE
curl -X POST localhost:8082/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@hitsdancemusic.ca","password":"change-me-now"}'
```
