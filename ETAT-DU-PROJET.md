# État du projet — Hits Dance Music (reprise sur Mac)

> Document de reprise : tout ce qu'il faut pour continuer le travail.
> Dernière mise à jour : 2026-06-18. Branche : `main` (déploiement auto Railway).

---

## 1. Ce qu'est devenu le projet

Au départ : une **landing page statique** (PWA vanilla JS) avec un player radio live.
Aujourd'hui : une **plateforme de gestion radio complète** :

- **Site public** (inchangé visuellement) — player live, grille, animateurs, émissions
- **API backend** (Hono + Drizzle + PostgreSQL) — auth, contenu, analytics
- **Console admin** (Next.js) — gestion grille / animateurs / émissions / podcasts / mixes / utilisateurs / **statistiques d'audience**
- **Service presence** (WebSocket) — compteur visiteurs live (existant)

Le site lit désormais son contenu (grille, animateurs, émissions) depuis l'API,
et envoie des **données d'audience** (analytics) que l'admin affiche en temps réel.

---

## 2. Services déployés (Railway)

Projet Railway unique, 5 services. **Chaque service = un sous-dossier avec son Dockerfile + `railway.json`.**

| Service Railway | Dossier repo | Rôle | Domaine public |
|---|---|---|---|
| `patient-endurance` | `api/` | API backend (port 8082) | `patient-endurance-production-21c8.up.railway.app` |
| `zucchini-charisma` | `admin/` | Console admin Next.js (port 3000) | `zucchini-charisma-production-3a67.up.railway.app` |
| `Postgres` | — (plugin) | Base de données | privé (`postgres.railway.internal`) |
| `HitsDanceMusic.ca` | `presence/` | Compteur WebSocket | `hitsdancemusicca-production.up.railway.app` |
| `hitdanceradio.ca` | `/` (racine) | Site statique (nginx) | `hitsdancemusic.ca` / `hitdancemusic.ca` |

> ⚠️ Les noms de services Railway (`patient-endurance`, `zucchini-charisma`) sont
> auto-générés et ne reflètent pas leur rôle — voir la colonne « Rôle ».

**Déploiement** : `git push origin main` → Railway rebuild et redéploie automatiquement
les services concernés. L'API applique **migrations + seed automatiquement** avant
de démarrer (`preDeployCommand` → `node dist/db/deploy.js`).

---

## 3. Accès

- **Admin** : https://zucchini-charisma-production-3a67.up.railway.app
  - Login : `admin@hitsdancemusic.ca`
  - Mot de passe : celui défini dans la variable `SEED_ADMIN_PASSWORD` du service `api`
    (actuellement faible — **à renforcer**, voir §7 Sécurité).
- **API health** : https://patient-endurance-production-21c8.up.railway.app/health
- **GitHub** : https://github.com/punkispike-cloud/HitsDanceMusic.ca (branche `main`)

---

## 4. Reprendre le développement (sur Mac)

```bash
git clone https://github.com/punkispike-cloud/HitsDanceMusic.ca.git
cd HitsDanceMusic.ca
# Node 20 requis (nvm install 20 && nvm use 20)
```

### API (backend) en local
```bash
cd api
cp .env.example .env            # ajuster DATABASE_URL + JWT_SECRET
npm install
# Postgres local rapide :
#   docker run -d --name hr-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
npm run db:migrate              # applique les migrations
npm run seed                    # superadmin + animateurs + émissions + grille
npm run dev                     # http://localhost:8082
```

### Admin (console) en local
```bash
cd admin
cp .env.example .env            # NEXT_PUBLIC_API_URL=http://localhost:8082
npm install
npm run dev                     # http://localhost:3000
```
(L'API doit tourner ; `http://localhost:3000` est déjà dans son `ALLOWED_ORIGINS`.)

### Site public en local
Servir la racine en statique (n'importe quel serveur) :
```bash
npx serve .        # ou: python3 -m http.server
```
> Le site appelle l'API de prod par défaut (URL codée dans `js/api-config.js`,
> surchargeable via `<meta name="hr-api-url">`).

### Après modification du site statique (JS/CSS/HTML du shell)
```bash
node scripts/build-sw.mjs       # recalcule le hash du service worker (sinon cache périmé)
```

### Tests API
```bash
cd api && npm test              # round-trip grille (SCHEDULE ↔ minutes)
```

---

## 5. Structure du repo

```
/                       → site statique (nginx) — service web
  index.html, animateurs.html, emissions.html, horaire.html, contact.html, stats.html
  js/                   → modules ES du site
    main.js             → orchestrateur (initCritical / initIdle)
    api-config.js       → base URL de l'API (NOUVEAU)
    analytics.js        → beacons d'audience vers /v1/track (NOUVEAU)
    content.js          → rend animateurs + émissions depuis l'API (NOUVEAU)
    schedule.js         → grille (fallback hardcodé + loadScheduleFromApi)
    player.js, presence.js, ...
  styles/               → CSS (29 fichiers séquentiels)
  sw.js                 → service worker (cache shell ; hash auto via build-sw.mjs)
  nginx.conf            → config + CSP (connect-src inclut l'API ; img-src inclut S3)
  scripts/build-sw.mjs, build-html.mjs

api/                    → backend Hono + Drizzle + PostgreSQL (TypeScript)
  src/
    index.ts            → app Hono, montage routes, shutdown
    env.ts              → validation env (BUILTIN_ORIGINS fusionnés — voir §8)
    db/{schema,client,migrate,seed,seed-data,deploy}.ts
    lib/{jwt,password,errors,validation,s3}.ts
    middleware/{cors,auth,rbac,rateLimit,error}.ts
    routes/{auth,public,admin,uploads,track,analytics-admin,health}.ts
    services/{auth,schedule,analytics}.ts
  migrations/           → SQL versionné (0000_init, 0001_analytics)
  railway.json          → preDeployCommand: node dist/db/deploy.js (migrate+seed)

admin/                  → console Next.js (App Router, TypeScript)
  app/
    login/, page.tsx
    (admin)/            → layout protégé + pages
      dashboard, statistiques, grille, animateurs, emissions, podcasts, mixes, utilisateurs
  components/           → crud, ui, toast, sidebar, audio-upload, image-upload
  lib/                  → api (client auto-refresh), auth (contexte), types

presence/               → service WebSocket (existant, inchangé)
```

Docs liées : [api/README.md](api/README.md), [admin/README.md](admin/README.md), [DEPLOY-RAILWAY.md](DEPLOY-RAILWAY.md).

---

## 6. Ce qui est FAIT ✅

- **Auth** : login/refresh (rotation + détection réutilisation)/logout/me/change-password ; rôles superadmin/animateur/lecteur ; RBAC ownership (`artist_id`).
- **Contenu** : CRUD animateurs (photo, bio, réseaux sociaux), émissions, grille (éditeur visuel par jour), podcasts, mixes, utilisateurs.
- **API publique** : `/v1/schedule` (format exact), `/v1/artists`, `/v1/shows`, `/v1/episodes`, `/v1/mixes`.
- **Site ↔ API** : grille + animateurs + émissions lus depuis l'API (visuel identique, fallback HTML).
- **Analytics** : beacons (pageview/heartbeat/listen) → IP, navigateur, appareil, **géoloc pays/ville**, temps sur le site, temps d'écoute par émission. Page admin « Statistiques » (live, moyennes, sessions+IP).
- **Upload audio + photo** : composants admin prêts (presign → PUT S3 → confirm). **Nécessite S3 configuré** (voir §7).
- **Infra** : déploiement Railway config-as-code, migrations + seed auto au deploy.

---

## 7. Ce qui RESTE à faire 🔜

### A. Activer S3 (pour upload photo + audio)
Le code est prêt ; il manque la config AWS :
1. Variables sur le service `api` (Railway → patient-endurance → Variables) :
   ```
   S3_REGION=ca-central-1
   S3_BUCKET=<ton-bucket>
   S3_ACCESS_KEY_ID=<...>
   S3_SECRET_ACCESS_KEY=<...>
   S3_PUBLIC_BASE_URL=https://<ton-bucket>.s3.ca-central-1.amazonaws.com
   ```
2. CORS du bucket S3 (AWS Console → S3 → bucket → Permissions → CORS) :
   ```json
   [{ "AllowedOrigins": ["https://zucchini-charisma-production-3a67.up.railway.app"],
      "AllowedMethods": ["PUT","GET","HEAD"], "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
   ```
   (`*.amazonaws.com` est déjà autorisé dans la CSP `img-src` du site.)

### B. Player podcasts/mixes sur le site public
Écouter les audios uploadés depuis le site (on-demand). Nécessite :
- une page/section qui liste `/v1/episodes` et `/v1/mixes`
- ajouter le domaine S3/CDN à la CSP `media-src` de `nginx.conf`

### C. ✅ FAIT — Fiche animateur détaillée
Clic sur une carte `.talent-card` → modal profil (grande photo, bio, réseaux,
ses émissions, prochains passages calculés depuis la grille). Fichiers :
`js/animateur-detail.js`, `styles/29-animateur-detail.css`, câblé dans `js/content.js`.
(Évolution possible : vraies pages `/animateurs/[slug]` pour le SEO.)

### D. Sécurité
- **Roter le mot de passe Postgres** (exposé pendant la mise en place).
- **Renforcer le mot de passe admin** (actuellement faible). Pas encore de page
  « changer mot de passe » dans l'admin — l'endpoint API existe (`POST /auth/change-password`).
- Mention **Loi 25** dans la politique de confidentialité (collecte d'IP).

### E. Bugs frontend
- ✅ **CORRIGÉ** — `nginx.conf` proxy `/np` : ajout de la zone `proxy_cache_path np_cache` + `proxy_cache` (le `proxy_cache_valid` était inerte sans zone).
- ⚠️ Faux positifs (NE PAS recorriger) : `clampString`/`clampLyrics` (`js/util.js`) sont **corrects** — leurs regexes `/[\x00-\x1F\x7F]+/g` strippent les caractères de contrôle et préservent tirets/espaces/newlines (l'affichage masquait les caractères de contrôle).
- Mineur (faible impact) : `js/player.js` `#liveTrackHint` n'est pas retiré après récupération des métadonnées.

### F. Optionnel
- Domaines custom `api.hitsdancemusic.ca` + `admin.hitsdancemusic.ca` (résout les cookies tiers proprement).
- Flux RSS podcasts (`/v1/rss/:showSlug`) pour Apple Podcasts/Spotify.

---

## 8. Pièges & leçons Railway (IMPORTANT pour continuer)

1. **`preDeployCommand` ne s'exécute PAS dans un shell** → `&&` ne chaîne pas.
   Utiliser un script node unique : `node dist/db/deploy.js` (lance migrate puis seed).
2. **Domaines `*.up.railway.app` = cross-site** (public suffix) → le cookie refresh
   doit être `SameSite=None; Secure` en prod (déjà fait dans `routes/auth.ts`).
3. **CORS** : le domaine admin est ajouté en dur dans `BUILTIN_ORIGINS` (`api/src/env.ts`)
   ET via `ALLOWED_ORIGINS`. Si le domaine admin change, mettre à jour les deux.
4. **Service worker** : après toute modif d'un fichier du `SHELL` (JS/CSS/HTML),
   relancer `node scripts/build-sw.mjs` sinon les utilisateurs gardent l'ancienne version.
5. **Seed idempotent** : ne re-seede le contenu que si la base est vierge → les
   éditions faites dans l'admin sont préservées à chaque redéploiement.
6. **Migrations** : générées avec `npm run db:generate` (drizzle-kit), committées dans
   `api/migrations/`, appliquées auto au deploy.

---

## 9. Variables d'environnement (référence)

### Service `api`
| Var | Rôle |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (privé) |
| `JWT_SECRET` | secret JWT (≥32 car.) |
| `ALLOWED_ORIGINS` | origines CORS (fusionné avec BUILTIN_ORIGINS) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | bootstrap superadmin |
| `S3_*` | stockage audio/photo (à configurer — §7) |
| `NODE_ENV=production` | |

### Service `admin`
| Var | Rôle |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL publique de l'API (inlinée au build) |

Détails complets dans `api/.env.example` et `admin/.env.example`.
