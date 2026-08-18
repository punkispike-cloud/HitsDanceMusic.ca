# État du projet — Hits Dance Music / En Ondes

> Document de reprise. Dernière mise à jour : **2026-08-17**.
> Branche : `main` (déploiement auto Railway). Runbook ops : [RUNBOOK-PRODUCTION.md](RUNBOOK-PRODUCTION.md) · [DEPLOY-OPS.md](DEPLOY-OPS.md).

---

## Snapshot 2026-08-17 — système code-complet, ops externes documentées

| Élément | État |
|---|---|
| Site live hitsdancemusic.ca | UP — PR #31 (14 améliorations) + PR #32 (WCAG 2.2 AA) en prod |
| API prod `patient-endurance` | UP — `verify:prod` vert |
| Admin prod | UP |
| Staging Railway | UP — `verify:staging` vert |
| Web Push (VAPID) | Code ✅ — clés à poser Railway ([DEPLOY-OPS.md §1](DEPLOY-OPS.md)) |
| S3/R2 uploads | Code ✅ gated — vars prod incomplètes ([DEPLOY-OPS.md §2](DEPLOY-OPS.md)) |
| AzuraCast + replay | Code ✅ gated — instance externe requise ([DEPLOY-OPS.md §3](DEPLOY-OPS.md)) |
| Stripe live | Code ✅ gated — compte live requis ([DEPLOY-OPS.md §4](DEPLOY-OPS.md)) |
| Contraste WCAG 2.2 AA | Tokens `--muted` corrigés — `npm run check:contrast` |

```bash
npm run verify:prod
npm run verify:staging
npm run check:contrast
npm run check:nginx-deny
```

### Reste ops (humain)

Voir **[DEPLOY-OPS.md](DEPLOY-OPS.md)** pour le guide complet. Priorité :

1. Poser **VAPID** sur Railway prod + staging (`npm run vapid` dans `api/`).
2. Corriger **S3_*** prod (endpoint/public URL tronqués) + CORS R2.
3. **Sentry** DSN api + admin (RUNBOOK §1.4).
4. Secrets **backup** GitHub Actions (workflow `backup.yml`).
5. **AzuraCast** + **Stripe live** quand comptes prêts.
6. Bascule prod `DATABASE_URL` → `enondes_app` après ~2 sem. staging stable (RUNBOOK §3.1).

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

1. Poser `SENTRY_DSN` (api) + `NEXT_PUBLIC_SENTRY_DSN` (admin) — rebuild admin.
   Vérif : `POST /v1/admin/health/sentry-test` → événement Sentry sous ~1 min.
2. **Activer les backups Postgres auto** : le système est construit
   (`api/scripts/backup-db.mjs` + workflow planifié `.github/workflows/backup.yml`,
   quotidien 03:17 ET, rétention 30 j, archive validée par `pg_restore --list`).
   Reste à poser les secrets GitHub (`BACKUP_DATABASE_URL`, `S3_ENDPOINT`,
   `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — voir en-tête du
   workflow) puis lancer un `workflow_dispatch` de validation. Le drill de
   restauration reste testé (RTO ~4 s).
3. **Vérifier les variables Railway prod** : `MIGRATE_DATABASE_URL` (owner) posé,
   `DATABASE_URL` encore owner (bascule au point 5), `ALLOWED_ORIGINS` liste
   site+admin+hub, `S3_*` vides (pas d'écriture R2 prod).
4. Après ~2 semaines staging RLS stable : basculer prod `DATABASE_URL` → `enondes_app`
   (garder `MIGRATE_DATABASE_URL`) — `test:rls` + `verify:staging` verts, puis `verify:prod`.
5. Stripe live / avocat / 1er client — voir RUNBOOK Vague 3.
6. Domaines custom `api.` / `admin.` (Vague 2.4) — cookies SameSite=Lax.

---

## Architecture (rappel)

- **Site public** — nginx racine (`hitdanceradio.ca`)
- **API** — Hono + Drizzle + Postgres (`api/`)
- **Admin** — Next.js (`admin/`)
- **Presence** — WebSocket (`presence/`)
- **Hub** — En Ondes multi-stations (`enondes-site/`)

Déploiement : `git push origin main` → Railway. API : `preDeployCommand` → `node dist/db/deploy.js` (migrate + seed).

Docs : [DEPLOY-RAILWAY.md](DEPLOY-RAILWAY.md) · [OPERATIONS.md](OPERATIONS.md) · [MULTITENANT-DEPLOIEMENT.md](MULTITENANT-DEPLOIEMENT.md) · [RUNBOOK-PRODUCTION.md](RUNBOOK-PRODUCTION.md).
