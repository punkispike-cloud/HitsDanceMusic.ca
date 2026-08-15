# Runbook production — Vague 1–3 (ops)

> Actions **Railway / GitHub / DNS / Stripe / légal** que le code seul ne peut pas
> faire. Secrets : générer en local, coller uniquement dans Railway — jamais dans
> un chat. Complète [OPERATIONS.md](OPERATIONS.md) et [SECURITE-ROTATION.md](SECURITE-ROTATION.md).

---

## Vague 1.4 — Sentry

1. Créer **deux** projets Sentry (api / admin), DSN distincts.
2. Service Railway `patient-endurance` (api) → variable `SENTRY_DSN=<dsn-api>`.
3. Service `zucchini-charisma` (admin) → `NEXT_PUBLIC_SENTRY_DSN=<dsn-admin>` (**rebuild** : variable inlinée au build Next).
4. Vérif : provoquer une erreur test → événement visible dans Sentry sous 1 min.

Code déjà gated : `api/src/services/monitoring.ts`, `admin/components/sentry-init.tsx`.

---

## Vague 1.5 — Brancher `enondes-hub` sur GitHub

1. Railway → service `enondes-hub` → Settings → Source.
2. Connecter le repo `HitsDanceMusic.ca`, branche `main`.
3. **Root Directory = `enondes-site`** (obligatoire).
4. Builder Dockerfile (fichier `enondes-site/Dockerfile`).
5. Déployer ; vérifier `https://enondes-hub-production.up.railway.app/`.

Ne **jamais** `railway up` depuis la racine du monorepo sans `--path-as-root` —
sinon le hub sert le site Hits Dance.

---

## Vague 2.1 — Staging + reviews GitHub

### GitHub

**Fait (2026-08-15)** : `required_approving_review_count = 1` + contexts CI
`Site (tests unitaires)` et `Smoke Playwright (pas de snapshots)` ajoutés aux
required status checks.

Si tu dois reposer :

```bash
# PowerShell
'{"required_approving_review_count":1}' | gh api -X PATCH repos/punkispike-cloud/HitsDanceMusic.ca/branches/main/protection/required_pull_request_reviews --input -
```

Ou UI : Settings → Branches → main → Require approvals = 1.

### Railway staging

**Créé (2026-08-15)** : environnement `staging` (duplication de `production`)
dans le projet `independent-perception` (id `7d622214-1b02-4d3d-bc28-bfbd65f40a8a`).

À faire ensuite dans le dashboard Railway :
1. Générer des domaines staging distincts (api/admin) — **pas** hitsdancemusic.ca.
2. Remplacer `JWT_SECRET` / `SEED_*` staging (ne pas partager la prod).
3. Désactiver Stripe live / webhooks prod sur staging.
4. Workflow : PR → CI → smoke staging manuel → merge `main` → prod.

### Railway staging (création)

```bash
railway environment new staging --duplicate production
railway environment link production   # revenir sur prod après
```

### Rollback

- **App seule** : revert du merge sur `main` → redeploy auto Railway.
- **Migration** : PITR Postgres + `npm run restore-drill` (voir SECURITE-ROTATION.md §4).
  La 0027 est additive — pas de DROP.

---

## Vague 2.3 — R2 / S3 (si podcasts / studio en prod)

Sur le service **api** uniquement (voir OPERATIONS.md §7) :

```
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_BASE_URL=https://pub-xxxx.r2.dev
S3_FORCE_PATH_STYLE=true
```

CORS bucket : origines admin + site ; méthodes GET/PUT/HEAD. Smoke : admin `/pistes` → `podcasts.html`.

Sans besoin produit immédiat : **ne pas** activer (uploads restent `503 s3_unconfigured`).

---

## Vague 2.4 — Domaines custom cookies

1. DNS : `api.hitsdancemusic.ca` → service api ; `admin.hitsdancemusic.ca` → admin.
2. Railway : Custom Domain sur chaque service + TLS.
3. Variables :
   - api : `ALLOWED_ORIGINS` (site + admin + hub), `ADMIN_BASE_URL`, `PUBLIC_SITE_URL`
   - admin : `NEXT_PUBLIC_API_URL=https://api.hitsdancemusic.ca` → **rebuild**
4. Site : CSP `connect-src` dans `nginx.conf` (URL API) + rebuild web.
5. Ensuite : cookie refresh peut repasser en `SameSite=Lax` (même parent) dans `api/src/routes/auth.ts`.

---

## Vague 3.1 — Activer le rôle `enondes_app` (après test:rls vert)

Prérequis code : middleware `bindRequestDb` + ALS déjà en place.

1. Sur Postgres (owner) :
   ```sql
   ALTER ROLE enondes_app WITH PASSWORD '<fort>';
   ```
2. Base **jetable** (pas Hits Dance prod) :
   ```bash
   DATABASE_URL="postgres://owner..." \
   RLS_TEST_URL="postgres://enondes_app..." \
   cd api && npm run test:rls
   ```
3. Si vert : pointer `DATABASE_URL` du service api **staging** puis prod sur `enondes_app`.
4. Ne pas fusionner un 2e tenant sur la base Hits Dance avant 2 semaines stables.

---

## Vague 3.2 — Stripe live

Variables api :

```
STRIPE_SECRET=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER_ID=price_...
STRIPE_PRICE_GROWTH_ID=price_...
STRIPE_PRICE_PRO_ID=price_...
```

Webhook Stripe → `https://<api>/v1/webhooks/stripe` (events `customer.subscription.*`).

Test mode d'abord : Checkout → ligne `subscriptions` ; cancel → radio `paused`.

---

## Vague 3.3 — Légal + 1er client

1. Avocat QC : valider `_private/CONTRAT-CLIENT.md` + `ATTESTATION-LICENCES.md`.
2. `npm run restore-drill` — noter le RTO.
3. 1er client = **instance Railway dédiée** (option A MULTITENANT-DEPLOIEMENT.md §3),
   pas la base Hits Dance partagée.
4. Attestation SOCAN + Ré:Sonne dans `brand/clients.json` avant go-live.
5. `npm run pre-go-live -- --slug <slug>` exit 0.
