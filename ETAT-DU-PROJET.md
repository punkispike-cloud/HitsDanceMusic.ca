# État du projet — Hits Dance Music / En Ondes

> Document de reprise. Dernière mise à jour : **2026-08-15**.
> Branche : `main` (déploiement auto Railway). Runbook ops : [RUNBOOK-PRODUCTION.md](RUNBOOK-PRODUCTION.md).

---

## Snapshot 2026-08-15 — production durcie + staging isolé

| Élément | État |
|---|---|
| Site live hitsdancemusic.ca | UP — deny nginx infra (404) |
| API prod `patient-endurance` | UP — migrations jusqu’à **0027**, RLS ALS runtime |
| Admin prod | UP — Sentry gated (`NEXT_PUBLIC_SENTRY_DSN`) |
| Staging Railway | UP — API/admin/site/hub domaines `*-staging.up.railway.app` |
| Postgres staging | **`Postgres-2fkU`** (TCP proxy). Orphelin `Postgres` **supprimé** |
| Postgres prod | Recréé + volume `postgres-volume` rattache (incident 2026-08-15 — voir RUNBOOK) |
| Presence staging | Domaine + `ALLOWED_ORIGINS` OK |
| RLS | **Staging runtime = `enondes_app`** (MIGRATE_DATABASE_URL owner). Prod : MIGRATE posé, runtime encore owner — bascule après 2 sem. stables |
| Hub En Ondes | GitHub branché, root `enondes-site/` — titre En Ondes OK |
| Headers | Site HSTS/XFO OK ; API `secureHeaders` (Hono) |

### URLs staging

- API : https://patient-endurance-staging.up.railway.app  
- Admin : https://zucchini-charisma-staging.up.railway.app  
- Site : https://hitdanceradioca-staging.up.railway.app  
- Hub : https://enondes-hub-staging.up.railway.app  
- Presence : https://hitsdancemusicca-staging.up.railway.app  

```bash
npm run verify:prod
npm run verify:staging
npm run check:nginx-deny
```

### Reste ops (humain)

1. Poser `SENTRY_DSN` (api) + `NEXT_PUBLIC_SENTRY_DSN` (admin) — rebuild admin
2. Après ~2 semaines staging RLS stable : basculer prod `DATABASE_URL` → `enondes_app` (garder `MIGRATE_DATABASE_URL`)
3. Stripe live / avocat / 1er client — voir RUNBOOK Vague 3
4. Domaines custom `api.` / `admin.` (Vague 2.4) — cookies SameSite=Lax via `REFRESH_COOKIE_SAMESITE`

### Remédiation audit prod (2026-08-16) — livrables code

- **A3** : garde anti-pollution des beacons `POST /v1/track` (cap création de
  sessions par IP/min, in-memory borné) — `api/src/routes/track.ts`.
- **A5** : géo-IP locale (`api/src/services/geoip.ts`) — plus de fuite d'IP vers
  un tiers ; MaxMind GeoLite2 via `GEOIP_DB_PATH` (défaut : aucune résolution).
- **A4** : déjà en place (bannière `js/consent.js` + gate `main.js` +
  `confidentialite.html` Loi 25).
- **Phase 2.2** : SSE `/v1/admin/analytics/stream` durci (GUC `app.radio_id`
  par snapshot → RLS active, pas seulement `WHERE radio_id`).
- **Phase 2.3** : tests HTTP `analytics-admin` (RBAC IP + scoping `radio_id`
  sur 8 routes) + isolation SQL PGlite (2 radios) + garde beacons + geoip.
- **Phase 4.1** : `REFRESH_COOKIE_SAMESITE` (env) pour repasser en Lax après
  domaines custom.
- **Phase 4.2** : `npm run verify:stripe` — vérif webhook (signature + idempotence).

---

## Architecture (rappel)

- **Site public** — nginx racine (`hitdanceradio.ca`)
- **API** — Hono + Drizzle + Postgres (`api/`)
- **Admin** — Next.js (`admin/`)
- **Presence** — WebSocket (`presence/`)
- **Hub** — En Ondes multi-stations (`enondes-site/`)

Déploiement : `git push origin main` → Railway. API : `preDeployCommand` → `node dist/db/deploy.js` (migrate + seed).

Docs : [DEPLOY-RAILWAY.md](DEPLOY-RAILWAY.md) · [OPERATIONS.md](OPERATIONS.md) · [MULTITENANT-DEPLOIEMENT.md](MULTITENANT-DEPLOIEMENT.md) · [RUNBOOK-PRODUCTION.md](RUNBOOK-PRODUCTION.md).
