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
| RLS | `test:rls` vert ; bascule runtime `enondes_app` **après** merge `MIGRATE_DATABASE_URL` |
| Hub En Ondes | GitHub branché, root `enondes-site/` (prod + staging) — titre En Ondes OK |

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
2. Après merge Vague 3.1 code : `node scripts/activate-enondes-app-staging.mjs` puis 2 semaines stables avant prod
3. Stripe live / avocat / 1er client — voir RUNBOOK Vague 3

---

## Architecture (rappel)

- **Site public** — nginx racine (`hitdanceradio.ca`)
- **API** — Hono + Drizzle + Postgres (`api/`)
- **Admin** — Next.js (`admin/`)
- **Presence** — WebSocket (`presence/`)
- **Hub** — En Ondes multi-stations (`enondes-site/`)

Déploiement : `git push origin main` → Railway. API : `preDeployCommand` → `node dist/db/deploy.js` (migrate + seed).

Docs : [DEPLOY-RAILWAY.md](DEPLOY-RAILWAY.md) · [OPERATIONS.md](OPERATIONS.md) · [MULTITENANT-DEPLOIEMENT.md](MULTITENANT-DEPLOIEMENT.md) · [RUNBOOK-PRODUCTION.md](RUNBOOK-PRODUCTION.md).
