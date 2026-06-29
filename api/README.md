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
   - `ALLOWED_ORIGINS` = `https://hitsdancemusic.ca,https://admin.hitsdancemusic.ca`
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
- `GET /v1/artists` · `/v1/artists/:slug`
- `GET /v1/shows` · `/v1/shows/:slug`
- `GET /v1/episodes` · `/v1/episodes/:slug`
- `GET /v1/mixes` · `/v1/mixes/:slug`

### Auth
- `POST /auth/login` → `{ accessToken, user }` (+ cookie refresh httpOnly)
- `POST /auth/refresh` → rotation, nouvelle paire
- `POST /auth/logout` · `GET /auth/me` · `POST /auth/change-password`
- `POST /auth/register` (superadmin uniquement)

### Admin (`/v1/admin/*`, Bearer requis)
- `artists`, `shows`, `schedule-slots`, `episodes`, `mixes`, `users` — CRUD
- Écriture : superadmin, ou animateur **propriétaire** (ownership via `artist_id`)
- `uploads/presign` + `uploads/confirm` — flux S3 pré-signé (Phase 4)

## Rôles

Deux axes de capacité (le rang linéaire ne sert qu'à l'anti-escalade/gestion) :

| Rôle | Scope | Éditorial | Technique cross-radio | Commercial (parc/billing) |
|---|---|---|---|---|
| `owner` | cross-radio | oui | oui | oui (god mode) |
| `it` | cross-radio | non | oui (monitoring parc) | non |
| `superadmin` | 1 radio | oui | non | non |
| `animateur` | 1 radio (son contenu) | son contenu | non | non |
| `lecteur` | 1 radio | lecture | non | non |

- `owner` = En Ondes (opérateur de la plateforme) ; `superadmin` = admin d'une radio cliente.
- `it` (IT) accède au monitoring technique du parc (santé, alertes, journal, stats) **sans** éditer le contenu ni toucher au billing.
- Écriture éditoriale : `superadmin` + `owner` (`requireEditorialAdmin`), ou animateur **propriétaire** (ownership via `artist_id`). `it` en est exclu.

## Sécurité

- Access JWT court (15 min) ; refresh opaque 30 j **haché** en DB (rotation +
  détection de réutilisation → révocation de chaîne).
- bcrypt coût 12 ; jamais de mot de passe loggé/renvoyé.
- CORS whitelisté (`ALLOWED_ORIGINS`), rate-limit global + strict sur `/auth/*`.
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
