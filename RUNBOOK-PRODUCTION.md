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

## Incident 2026-08-15 — suppression Postgres cross-env

`railway serviceDelete` / GraphQL `serviceDelete` sur le service **`Postgres`**
supprime le service **dans tous les environnements** (pas seulement staging).

Conséquence : API prod → 503 (DB down). Volume `postgres-volume` (~1.7 Go) était
intact (détaché). Remède appliqué : recreer service `Postgres`, rattacher le
volume, realigner le mot de passe, reposer `DATABASE_URL` sur l’API.

**Règle** : ne jamais `serviceDelete` un service partagé prod/staging ; pour un
orphelin staging, préférer détacher/supprimer le **volume** ou renommer, et
vérifier qu’aucune instance prod n’y est liée.

---

## Vague 1.5 — Brancher `enondes-hub` sur GitHub

**Fait (2026-08-15)** : repo `punkispike-cloud/HitsDanceMusic.ca` branché,  
`rootDirectory = enondes-site` (prod + staging). Builder Railway = RAILPACK
(détecte le Dockerfile du sous-dossier). Vérifier
`https://enondes-hub-production.up.railway.app/` (titre En Ondes, pas Hits Dance).

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

**Créé (2026-08-15)** : environnement `staging` dans
`independent-perception` (id `7d622214-1b02-4d3d-bc28-bfbd65f40a8a`).

**État ops (2026-08-15 soir)** — staging API **UP** et isolée :
- API : https://patient-endurance-staging.up.railway.app (`verify-deploy` vert)
- Admin : https://zucchini-charisma-staging.up.railway.app
- Site : https://hitdanceradioca-staging.up.railway.app
- Postgres dédié : service `Postgres-2fkU` (ne pas utiliser l’ancien `Postgres`
  dupliqué de prod — mot de passe désynchronisé)
- `JWT_SECRET` / `SEED_*` rotés ; vars `S3_*` retirées (pas d’écriture R2 prod)
- `ALLOWED_ORIGINS` / `NEXT_PUBLIC_API_URL` pointent vers les domaines staging

Reste : brancher le hub sur GitHub ; Sentry DSN ; éventuellement supprimer
l’ancien service `Postgres` orphelin du staging.

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

**Fait (2026-08-15)** : sur staging `Postgres-2fkU` (TCP proxy `kodama.proxy.rlwy.net`),  
`node scripts/setup-rls-role.mjs <DATABASE_PUBLIC_URL>` → **test:rls vert** (isolation confirmée).

1. Sur Postgres (owner) — ou via le script ci-dessus :
   ```sql
   ALTER ROLE enondes_app WITH PASSWORD '<fort>';
   ```
2. Base **jetable / staging** (pas Hits Dance prod) :
   ```bash
   # Préfère le script (crée le rôle + lance api/scripts/test-rls.mjs) :
   node scripts/setup-rls-role.mjs "$DATABASE_PUBLIC_URL"
   ```
3. Si vert : pointer `DATABASE_URL` du service api **staging** puis prod sur `enondes_app`.
   - Poser aussi `MIGRATE_DATABASE_URL` = URL **owner** (`postgres`) — utilisé uniquement
     par `node dist/db/deploy.js` (migrate + seed). Sans ça, le preDeploy échoue (DDL).
   - Staging one-shot :
     `node scripts/activate-enondes-app-staging.mjs` puis `npm run verify:staging`.

**Fait staging (2026-08-15)** : runtime API = `enondes_app`, migrate/seed via
`MIGRATE_DATABASE_URL`, `verify:staging` vert.

**Prod** : `MIGRATE_DATABASE_URL` déjà posé ; **ne pas** basculer `DATABASE_URL`
avant ~2 semaines stables sur staging.

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
