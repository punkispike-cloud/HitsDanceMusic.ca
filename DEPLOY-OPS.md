# Déploiement ops — compléter le système En Ondes

> Guide pas-à-pas pour activer les services **externes** que le code ne peut pas
> provisionner seul. Secrets : générer en local, coller **uniquement** dans Railway
> ou GitHub Secrets — jamais dans le dépôt ni un chat.

Complète [RUNBOOK-PRODUCTION.md](RUNBOOK-PRODUCTION.md) et [OPERATIONS.md](OPERATIONS.md).

---

## État actuel (2026-08-17)

| Service | Code | Prod Railway | Action |
|---------|------|--------------|--------|
| API + DB + RLS staging | ✅ | ✅ | `verify:prod` / `verify:staging` verts |
| Web Push (VAPID) | ✅ | ⚙️ à poser | Voir §1 |
| S3 / R2 (uploads audio) | ✅ gated | ⚠️ vars incomplètes | Voir §2 |
| AzuraCast + replay | ✅ gated | ❌ | Voir §3 |
| Stripe live | ✅ gated | ❌ | Voir §4 |
| Sentry | ✅ gated | ❌ | RUNBOOK §1.4 |
| Backups Postgres → R2 | ✅ script | ❌ secrets GitHub | `.github/workflows/backup.yml` |
| Contraste WCAG 2.2 AA | ✅ tokens | ✅ | `npm run check:contrast` |

---

## 1. Web Push (VAPID) — rappels d'émission

### Générer les clés (une fois)

```bash
cd api
npm run vapid
```

Copie la sortie dans `_private/vapid-keys.txt` (gitignored) pour référence locale.

### Poser sur Railway (service `patient-endurance`)

**Production :**

```bash
railway link   # projet independent-perception, env production
railway variables --service patient-endurance \
  --set "VAPID_PUBLIC_KEY=<clé publique>" \
  --set "VAPID_PRIVATE_KEY=<clé privée>" \
  --set "VAPID_SUBJECT=mailto:admin@hitsdancemusic.ca"
```

Répéter pour l'environnement **staging** (mêmes clés ou paire dédiée).

Redeploy automatique → vérifier :

```bash
curl -s https://patient-endurance-production-21c8.up.railway.app/v1/push/vapid-public-key
# Attendu : { "enabled": true, "key": "B..." }
```

Sur le site : `podcasts.html` → bouton « Recevoir les rappels » visible si le navigateur supporte Push.

---

## 2. Cloudflare R2 / S3 — uploads audio & studio DJ

Le code est prêt (`api/src/lib/s3.ts`, routes `/v1/admin/uploads/*`). Sans vars complètes → `503 s3_unconfigured`.

### Créer le bucket R2

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → R2 → Create bucket (ex. `enondes-media`).
2. R2 → Manage R2 API Tokens → Create token (Object Read & Write).
3. Noter : Account ID, Access Key ID, Secret Access Key.
4. Activer **Public access** (r2.dev subdomain ou domaine custom) pour la lecture des mixes.

### Variables Railway (service `api`)

```
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=enondes-media
S3_ACCESS_KEY_ID=<access-key>
S3_SECRET_ACCESS_KEY=<secret-key>
S3_PUBLIC_BASE_URL=https://pub-<hash>.r2.dev
S3_FORCE_PATH_STYLE=true
MAX_AUDIO_BYTES=524288000
```

> ⚠️ **Prod actuelle** : `S3_ENDPOINT` et `S3_PUBLIC_BASE_URL` semblent tronqués
> (`https://` seul). Corriger dans Railway → Variables → redeploy.

### CORS bucket R2

Autoriser origines **admin** + **site** + **hub** :

- Méthodes : `GET`, `PUT`, `HEAD`
- Headers : `*` (ou `Content-Type`, `Content-Length`)

### Smoke test

1. Admin → `/pistes` → upload audio → succès.
2. Admin → `/studio` → publier un mix → visible sur `podcasts.html`.
3. `curl -I <S3_PUBLIC_BASE_URL>/...` → 200.

---

## 3. AzuraCast — flux managé + replay automatique

Code : `api/src/services/azuracast.ts`, `api/src/services/replay.ts`.

### Provisionner AzuraCast

1. Déployer [AzuraCast](https://www.azuracast.com/) (VPS, Docker, ou AzuraCast Cloud).
2. Créer une clé API (Administration → API Keys).
3. Créer la station Hits Dance (ou laisser le provisioning owner le faire si vars posées).

### Variables Railway (service `api`)

```
AZURACAST_BASE_URL=https://radio.example.com
AZURACAST_API_KEY=<api-key>
# Replay catch-up (optionnel, après validation API recordings) :
AZURACAST_REPLAY_ENABLED=true
REPLAY_INTERVAL_MS=900000
```

### Vérification

- Owner → création radio → station AzuraCast provisionnée (si vars OK).
- Logs API : `[replay] brouillons créés : N` après un direct enregistré.
- Sans vars : provisioning sans flux, replay inactif (comportement safe).

---

## 4. Stripe live — facturation paliers

Code : `api/src/routes/owner.ts`, webhook `/v1/webhooks/stripe`.

### Dashboard Stripe

1. Mode **Live** → Products → créer 3 prix récurrents (Starter / Growth / Pro).
2. Developers → Webhooks → endpoint `https://<api>/v1/webhooks/stripe`.
3. Events : `customer.subscription.created`, `updated`, `deleted`.
4. Copier `whsec_...`.

### Variables Railway (service `api`)

```
STRIPE_SECRET=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER_ID=price_...
STRIPE_PRICE_GROWTH_ID=price_...
STRIPE_PRICE_PRO_ID=price_...
```

### Vérification

```bash
# Test mode d'abord sur staging avec sk_test_...
npm run verify:stripe
# ou staging :
node scripts/verify-stripe.mjs https://patient-endurance-staging.up.railway.app
```

Checkout owner → ligne `subscriptions` ; cancel → radio `paused`.

---

## 5. Sentry — monitoring erreurs

Voir RUNBOOK §1.4. Deux projets (api + admin), DSN distincts.

```
# api (patient-endurance)
SENTRY_DSN=https://...@sentry.io/...

# admin (zucchini-charisma) — rebuild Next requis
NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
```

Test : `POST /v1/admin/health/sentry-test` (auth admin).

---

## 6. Backups Postgres automatiques

Workflow `.github/workflows/backup.yml` — secrets GitHub requis :

| Secret | Description |
|--------|-------------|
| `BACKUP_DATABASE_URL` | URL publique Postgres prod |
| `S3_ENDPOINT` | Endpoint R2 backups |
| `S3_BUCKET` | Bucket dédié backups |
| `S3_ACCESS_KEY_ID` | |
| `S3_SECRET_ACCESS_KEY` | |

Validation : Actions → Backup Postgres → Run workflow.

Restauration : `npm run restore-drill`.

---

## 7. Checklist post-déploiement

```bash
npm run verify:prod
npm run verify:staging
npm run check:contrast
npm run check:nginx-deny
cd api && npm test
npm test
```

Optionnel (RLS prod cutover) : `npm run verify:rls-cutover` quand staging stable ≥2 sem.

---

## 8. Ordre recommandé d'activation

1. **VAPID** — impact immédiat auditeurs, zero coût.
2. **S3/R2** — débloque studio DJ + podcasts uploadés.
3. **Sentry** — visibilité erreurs avant scale.
4. **Backups GitHub** — protection données.
5. **AzuraCast** — si flux managé requis.
6. **Stripe live** — quand 1er client payant prêt + contrat avocat (RUNBOOK §3.3).
