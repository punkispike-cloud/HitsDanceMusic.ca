# Hits Dance Music — Admin

Console d'administration (Next.js App Router, TypeScript) pour gérer la grille,
les animateurs, les émissions, les podcasts et les mixes. Consomme l'API
(`api/`) via `NEXT_PUBLIC_API_URL`.

> Application interne (non indexée). Charte sombre reprise du site public.

## Architecture

- **Auth** : access token JWT gardé **en mémoire** (jamais localStorage),
  refresh token en cookie httpOnly géré par l'API. Reprise de session
  silencieuse au chargement (`/auth/refresh`). Auto-refresh au 401.
- **Rôles** : `superadmin` (tout), `animateur` (édite uniquement son contenu),
  `lecteur` (lecture). Le menu et les actions s'adaptent au rôle.
- **Pages** : dashboard · grille (éditeur visuel par jour) · animateurs ·
  émissions · podcasts · mixes · utilisateurs (superadmin).
- **CRUD générique** : `components/crud.tsx` piloté par configuration de champs
  → la plupart des pages sont de petites configs. La grille a son éditeur dédié.

## Développement local

```bash
cd admin
cp .env.example .env          # NEXT_PUBLIC_API_URL=http://localhost:8082
npm install
npm run dev                   # http://localhost:3000
```

L'API (`api/`) doit tourner en parallèle, avec `http://localhost:3000` dans son
`ALLOWED_ORIGINS` (déjà présent dans `api/.env.example`).

## Déploiement Railway

1. **+ New → GitHub Repo → HitsDanceMusic.ca**, puis **Settings → Source** :
   - **Root Directory** : `admin`
   - **Builder** : Dockerfile
2. **Variables** (build ET runtime — `NEXT_PUBLIC_*` est inliné au build) :
   - `NEXT_PUBLIC_API_URL` = `https://api.hitsdancemusic.ca`
   - Railway passe l'`ARG` au build via la variable de service.
3. **Generate Domain** → idéalement `admin.hitsdancemusic.ca` (même domaine
   parent que l'API → cookie refresh propre).
4. Ajouter ce domaine à `ALLOWED_ORIGINS` du service `api`.

## Build / vérif

```bash
npm run build        # next build (typecheck inclus)
npm run typecheck    # tsc seul
```
