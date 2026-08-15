# 🛠️ Opérations En Ondes — gérer le parc de radios

> La **bible de l'opérateur**. Comment gérer tous les clients d'un seul endroit :
> registre, statut, mises à jour, monitoring, sauvegardes, sécurité. Le but :
> **plus de clients sans plus de chaos.**

---

## 1. Le registre des clients

`brand/clients.json` = **la source de vérité** de ton parc (slug, domaines, branche,
projet Railway, palier, **attestation licences**, date de mise en service).

> 🔒 **Confidentialité** : ce fichier liste tes clients. Si un client obtient un accès
> au dépôt, déplace-le hors du repo (gitignore) et garde-le sur ta machine.

À tenir à jour : **ajouter chaque nouveau client** ici à la fin de l'onboarding
(voir `ONBOARDING-CLIENT.md`, dernière case de la checklist).

---

## 2. Statut quotidien — « tout est en ligne ? »

🧰 `node scripts/status.mjs`

Ping le `/health` de chaque client actif → tableau **🟢 UP / 🔴 DOWN**, état DB,
temps de réponse, et rappel des **licences non attestées**. À lancer chaque matin
(ou via un cron). Sort en code 1 si un client est DOWN (utilisable en alerte).

---

## 2b. Centre de contrôle — le cockpit visuel

🧰 `node scripts/console.mjs` → ouvre **`http://127.0.0.1:4477`**

La version **visuelle** de `status.mjs` : un tableau de bord web où tu vois tout ton
parc d'un coup d'œil et **gères chaque radio depuis le même endroit**.

- **KPIs** : nb de radios · en ligne / hors ligne · licences à confirmer · (revenu
  mensuel **seulement** si un montant `billing.mrr` est renseigné dans `clients.json`).
- **Tableau du parc** : état (santé live), DB, latence, palier, licences, mise en
  service, et **actions** par radio (ouvrir le *site*, l'*admin*, les *stats*, copier
  la commande `verify-deploy`).
- **Cycle de vie** : `active` (pingée), `provisioning` (déployée pas encore), `paused`.
- **Panneau onboarding** : les 5 étapes/commandes pour monter une nouvelle radio.

> 🔒 **Local uniquement** : le serveur n'écoute que sur `127.0.0.1`, ne fait aucune
> écriture et n'expose aucun secret (le registre ne contient que des domaines publics).
> Port custom : `node scripts/console.mjs --port 5000`. (Un portail déployé — consultable
> du téléphone — = ajouter auth + hébergement, étape ultérieure.)

---

## 3. Mises à jour mutualisées — corriger 1 fois, livrer à tous

Le code est **partagé** ; chaque client a sa **branche** + son **projet Railway**.
Pour propager un correctif :

1. Corriger sur `main`, vérifier la **CI verte**.
2. 🧰 `node scripts/update-clients.mjs` → imprime les commandes exactes par client
   (`git merge main` → `BRAND=<slug> build-all` → `push` → `verify-deploy`).
3. Lancer ces commandes par client.
4. 🧰 `node scripts/status.mjs` → confirmer tout le parc 🟢.

> Hits Dance = baseline `main` → à jour dès le push sur `main`.

---

## 4. Monitoring des erreurs

- **Sentry par projet** : poser `SENTRY_DSN` sur l'`api` de chaque client (DSN
  distinct par client → erreurs isolées). Déjà branché côté code (gated).
- **Admin** : `NEXT_PUBLIC_SENTRY_DSN` sur le service admin (rebuild Next requis).
- Checklist ops Vagues 1–3 : **`RUNBOOK-PRODUCTION.md`**.
- Le `/health` (statut) couvre le « up/down » ; Sentry couvre le « pourquoi ça casse ».

---

## 5. Sauvegardes & restauration

- **Activer les backups Postgres** de chaque projet Railway.
- 🔑 **Tester une restauration au moins une fois** (un backup jamais restauré n'est
  pas un backup) — désormais automatisé et répétable :
  ```bash
  SOURCE_DATABASE_URL="$DATABASE_PUBLIC_URL" \
  DRILL_ADMIN_URL="postgres://.../postgres" \
  npm run restore-drill
  ```
  Dump source → base jetable `restore_drill` → `pg_restore` → vérif de parité
  (comptes + empreintes + migrations) → nettoyage. Restitue le **RTO**, exit 1 si écart.
- Rétention analytics (Loi 25) : purge auto à `ANALYTICS_RETENTION_DAYS` (défaut 180 j).
- 📓 Procédure pas-à-pas : **`SECURITE-ROTATION.md` §4**.

---

## 6. Sécurité par client

- `JWT_SECRET` **unique** par client (jamais partagé).
- Rotation des secrets si exposition → **runbook ordonné : `SECURITE-ROTATION.md`**
  (générer en local, jamais coller un secret dans un chat).
- Chaque client a son superadmin ; lui faire changer son mot de passe à la livraison.
- ⚖️ **Attestation de licences** archivée dans le registre avant exploitation.

---

## 7. Stockage audio (Cloudflare R2 / S3) — uploads & CORS

Les podcasts, mixes et pistes de la bibliothèque passent par un stockage objet
S3-compatible (Cloudflare R2 en pratique). Le code est prêt et **gated** : tant
que les variables ne sont pas posées, `POST /v1/admin/uploads/{presign,confirm}`
renvoient **`503 s3_unconfigured`** et l'admin affiche l'erreur côté UI.

> Référence détaillée (vars + CORS bucket) : **`DECK-DJ-STUDIO-ETAT.md`** § « Ce
> qu'il reste (ops) ». Cette section est le runbook court côté opérateur.

### Variables à poser sur le service `api` (Railway)

```
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=<nom-du-bucket>
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_BASE_URL=https://pub-xxxx.r2.dev   # ou domaine custom
S3_FORCE_PATH_STYLE=true
```

Les **4 premières obligatoires** (`S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`) déterminent le gate `isS3Configured()` (`api/src/env.ts`).
`S3_PUBLIC_BASE_URL` / `S3_ENDPOINT` ne sont pas dans le gate — une mauvaise URL
publique « passe » la config mais casse les URL de lecture.

### CORS — deux couches à ne pas confondre

1. **API CORS** (`ALLOWED_ORIGINS` sur `api`) — navigateur → API (presign/confirm).
   Doit inclure l'origine **admin** (et le site public / hub si besoin).
2. **CORS du bucket R2** — navigateur → R2 (PUT direct + GET lecture). Autoriser
   les origines **admin** et **site public**, méthodes `GET` / `PUT` / `HEAD`,
   headers `*` (exposer `ETag`).

### Smoke test après activation

1. Admin `/pistes` : téléverser une piste → ligne créée + audio attaché.
2. Admin `/studio` : rendre un mix → « Publier comme mix » → mix en brouillon.
3. Site public `podcasts.html` : lecture du mix/épisode téléversé (URL publique).
4. Si domaine R2 custom : l'ajouter aussi au CSP `media-src` (`nginx.conf`).

> Pas de `S3_*` ? Le déploiement se fait quand même ; les uploads restent en
> `503 s3_unconfigured` jusqu'à configuration. Le studio fonctionne en local
> (rendu/téléchargement) — seul le persisté (bibliothèque + publication mix) échoue.

---

## Commandes utiles (mémo)

```bash
node scripts/new-client.mjs <slug> "Nom"      # créer un client
BRAND=<slug> node scripts/build-all.mjs       # bâtir son site
node scripts/verify-deploy.mjs <api-url>      # vérifier un déploiement
node scripts/status.mjs                       # statut du parc (CLI)
node scripts/console.mjs                      # centre de contrôle (cockpit web local)
node scripts/update-clients.mjs               # propager une mise à jour
npm run restore-drill                         # drill de restauration Postgres (RTO + parité)
npm run sync-registry                         # merge brand/clients.json depuis la table radios (DB = source)
npm run provision -- --slug <slug>            # orchestrateur provisioning : build + railway + dns + activation
npm run add-to-registry -- --slug <slug> …    # consigner un client au registre ops (champs commerciaux/ops)
npm run gen-paperwork -- --slug <slug> …      # remplir contrat + attestation licences depuis les gabarits _private
npm run pre-go-live -- --slug <slug>          # checklist de mise en ondes (registre/marque/paperasse/DB/API/DNS)
```

## Provisioning d'un client (Phase 5/A3)

1. **Créer le tenant** via la console admin (`/parc` → nouveau client) ou `POST /v1/owner/radios`
   avec `superadminEmail` + `plan` + `createSubscription: true`. La radio naît en
   `provisioning` ; un superadmin est créé (mot de passe temporaire renvoyé une fois)
   et une ligne `subscriptions` (statut `trialing`) est posée.
2. **Mettre en ondes** : `DATABASE_URL=… npm run provision -- --slug <slug>
   --site-target <web>.up.railway.app --api-target <api>.up.railway.app
   --admin-target <admin>.up.railway.app`. Le script : `npm run build` → Railway
   (CLI si `RAILWAY_TOKEN`) → DNS Cloudflare (si `CLOUDFLARE_API_TOKEN` +
   `CLOUDFLARE_ZONE_ID` + `CLOUDFLARE_APEX`) → bascule `status = active`. Chaque
   étape non configurée est imprimée comme étape manuelle (rien ne casse).
3. **Synchroniser le registre ops** : `npm run sync-registry` met à jour
   `brand/clients.json` depuis la table `radios` (status/tier/licences/billing),
   en préservant les champs ops-only (branch, railwayProject, domains, listing).

## Onboarding commercial (Phase 6/C)

1. `npm run add-to-registry -- --slug <slug> --name "Nom" --tier starter
   --contact-email … --branch client/<slug> --site-domain … --api-domain …
   --admin-domain …` — consigne le client au registre ops privé (`brand/clients.json`).
2. `node scripts/new-client.mjs <slug> "Nom"` — scaffold la marque (`brand/<slug>.json`
   + `brand/<slug>/assets/`), à compléter (flux, couleurs, visuels).
3. `npm run gen-paperwork -- --slug <slug> --legal-name "Société inc." --radio "Nom"
   --domain <site>` — remplit `_private/CONTRAT-CLIENT.md` + `ATTESTATION-LICENCES.md`
   → `_private/clients/<slug>/` (signatures + validation avocat·e à part).
4. Créer le tenant + mettre en ondes (cf. « Provisioning » ci-dessus).
5. `DATABASE_URL=… npm run pre-go-live -- --slug <slug>` — checklist finale
   (registre, marque, paperasse, DB radio/superadmin/abonnement, API santé, DNS).
   Exit 0 = prête à go live.

