# Déploiement Railway — Hits Dance Music

Runbook complet pour déployer les **5 composants** du projet sur un seul projet
Railway (monorepo, 1 service = 1 sous-dossier avec son Dockerfile).

## Vue d'ensemble des services

| Service | Root Directory | Port | Domaine cible | Rôle |
|---|---|---|---|---|
| `web` | `/` | 8080 | hitsdancemusic.ca | Site statique (nginx) — **existant** |
| `presence` | `presence` | 8081 | (généré) | Compteur WebSocket — **existant** |
| `Postgres` | — (plugin) | 5432 | privé | Base de données — **nouveau** |
| `api` | `api` | 8082 | api.hitsdancemusic.ca | Backend (auth, contenu) — **nouveau** |
| `admin` | `admin` | 3000 | admin.hitsdancemusic.ca | Console Next.js — **nouveau** |

Chaque service a son `railway.json` (builder Dockerfile + healthcheck + restart).
L'`api` lance ses **migrations automatiquement** avant chaque déploiement
(`preDeployCommand: node dist/db/deploy.js` — migrate + seed idempotent, via
`MIGRATE_DATABASE_URL` si posé, sinon `DATABASE_URL`).

---

## Ordre de déploiement

### 1. PostgreSQL
**+ New → Database → PostgreSQL**. Railway crée la base et expose :
- `DATABASE_URL` (privé, `postgres.railway.internal`) — pour l'API en prod
- `DATABASE_PUBLIC_URL` (proxy public) — pour le seed depuis ta machine

### 2. Service `api`
1. **+ New → GitHub Repo → HitsDanceMusic.ca**
2. **Settings → Source → Root Directory** = `api` (Builder : Dockerfile, auto)
3. **Variables** :
   ```
   DATABASE_URL = ${{Postgres.DATABASE_URL}}
   JWT_SECRET   = <openssl rand -base64 48>
   ALLOWED_ORIGINS = https://hitsdancemusic.ca,https://admin.hitsdancemusic.ca
   SEED_ADMIN_EMAIL = admin@hitsdancemusic.ca
   SEED_ADMIN_PASSWORD = <mot de passe fort>
   NODE_ENV = production
   ```
   (S3 plus tard — Phase 4 : `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
   `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`)
4. **Deploy** → le `preDeployCommand` applique les migrations, puis l'API démarre.
   Vérifier le healthcheck `/health` au vert.
5. **Settings → Networking → Generate Domain** (ou custom `api.hitsdancemusic.ca`).

> ⚠️ Toutes les variables doivent être posées AVANT le 1er déploiement : l'API
> refuse de booter sans `JWT_SECRET`/`DATABASE_URL` (fail-fast voulu).

### 3. Seed initial (une seule fois)
Le seed importe animateurs/émissions/grille et crée le superadmin. **À lancer
UNE fois** (il réinitialise la grille — ne pas relancer après édition admin).

Depuis ta machine, dans `api/`, avec l'URL publique de la base :
```bash
cd api
# DATABASE_URL = la valeur de DATABASE_PUBLIC_URL du service Postgres
DATABASE_URL="postgres://...public..." JWT_SECRET="peu-importe-ici-32+chars" \
SEED_ADMIN_EMAIL="admin@hitsdancemusic.ca" SEED_ADMIN_PASSWORD="<fort>" \
npm run seed
```
(Sur Windows PowerShell : `$env:DATABASE_URL="..."; $env:JWT_SECRET="..."; npm run seed`)

Vérifier : `GET https://<api>/v1/schedule` doit refléter la grille.

### 4. Service `admin`
1. **+ New → GitHub Repo → HitsDanceMusic.ca**
2. **Root Directory** = `admin`
3. **Variables** (build ET runtime — `NEXT_PUBLIC_*` est inliné au build) :
   ```
   NEXT_PUBLIC_API_URL = https://api.hitsdancemusic.ca
   ```
4. **Deploy** → healthcheck `/` au vert.
5. **Generate Domain** → custom `admin.hitsdancemusic.ca` recommandé.

### 5. Câblage final des origines
Une fois les domaines connus, mettre à jour la variable `ALLOWED_ORIGINS` du
service `api` pour inclure le domaine exact de l'admin, puis redéployer l'api :
```
ALLOWED_ORIGINS = https://hitsdancemusic.ca,https://admin.hitsdancemusic.ca
```
Domaines `api.` et `admin.` sous le même parent `hitsdancemusic.ca` → le cookie
refresh (`SameSite=Strict`, `Secure`, httpOnly) fonctionne proprement.

---

## Variables par service (récapitulatif)

### `api`
| Var | Obligatoire | Valeur |
|---|---|---|
| `DATABASE_URL` | ✅ | `${{Postgres.DATABASE_URL}}` |
| `JWT_SECRET` | ✅ | aléatoire ≥ 32 caractères |
| `ALLOWED_ORIGINS` | ✅ | domaines site + admin |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | seed | bootstrap superadmin |
| `NODE_ENV` | reco | `production` |
| `PORT` | auto | injecté par Railway |
| `S3_*` | Phase 4 | clés du compte S3 |

### `admin`
| Var | Obligatoire | Valeur |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | ✅ (build) | `https://api.hitsdancemusic.ca` |

### `presence` (existant — rappel)
| Var | Valeur |
|---|---|
| `ALLOWED_ORIGINS` | `https://hitsdancemusic.ca,https://www.hitsdancemusic.ca,<domaine railway>` |

### `web` (existant — aucune variable requise)

---

## Vérification post-déploiement

```bash
curl https://<api>/health                 # { ok:true, db:true }
curl https://<api>/v1/schedule            # grille (après seed)
curl -X POST https://<api>/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@hitsdancemusic.ca","password":"<fort>"}'
# → { accessToken, user } + cookie refresh
```
- Ouvrir `https://<admin>` → login avec le superadmin → dashboard.
- Créer un animateur, éditer un créneau de grille → vérifier via `GET /v1/schedule`.
- Confirmer que `web` et `presence` tournent toujours (frontend inchangé).

## Notes d'architecture

- **Migrations** : automatiques via `preDeployCommand` (idempotentes, versionnées
  dans `api/migrations/`). Pas dans le `CMD` → pas de course multi-instances.
- **Seed** : manuel, une fois. Réinitialise la grille → ne jamais relancer en prod
  après édition via l'admin.
- **Réseau** : l'API parle à Postgres en privé (`DATABASE_URL` interne). L'admin
  parle à l'API via son domaine public.
- **Frontend gelé** : `web` et `presence` ne sont pas modifiés. Le branchement du
  site public sur l'API est une phase ultérieure.
