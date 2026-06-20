# 🚀 Onboarding d'un client radio (runbook Autologix)

> Procédure **répétable** pour brancher une nouvelle radio cliente, de la collecte
> d'infos à la livraison. Objectif : **< 1 journée**. Modèle « une instance par
> client » (1 projet Railway + 1 base par radio). Pour Hits Dance Music (client #0),
> voir aussi `DEPLOY-RAILWAY.md`.

**Légende** : 🧰 commande · 🔒 action manuelle (Railway / DNS) · ⚖️ légal

---

## Étape 0 — Collecte (avant de toucher au code)

Réunir auprès du client :
- **Nom** de la radio + slug court (ex. `radiosoleil`)
- **Logo**, favicon, image de fond, couleur d'accent
- **Flux audio** : URL du stream + host + URL now-playing `7.html` (compte
  AsuraHosting/Shoutcast/Icecast du client)
- **Domaine** souhaité (ou on génère un domaine Railway)
- **Coordonnées** : téléphone studio, courriel, réseaux sociaux
- ⚖️ **Attestation licences** : confirmation écrite que le client détient
  **SOCAN** (auteurs/éditeurs) **et Ré:Sonne** (artistes/labels). **Sans ça, on
  n'héberge pas la diffusion.** (Posture Autologix : le client est responsable de
  ses licences.)

---

## Étape 1 — Scaffold du client

🧰 Depuis un **checkout propre** du repo (jamais sur `main` modifié) :
```bash
node scripts/new-client.mjs radiosoleil "Radio Soleil"
```
Crée `brand/radiosoleil.json` (à compléter) + `brand/radiosoleil/assets/`.

---

## Étape 2 — Remplir la config

Éditer `brand/radiosoleil.json` — remplacer tous les `CHANGEME` / `À_REMPLIR` :
- `domain`, `colors.*`, `stream.{url,panel,host,nowPlayingProxy}`,
  `urls.{api,presenceWss}`, `contact.{phone,email}`.
- Déposer logo/favicon/icônes dans `brand/radiosoleil/assets/`.

Voir `brand/README.md` pour le détail de chaque champ.

---

## Étape 3 — Bâtir le site brandé

🧰 Sur ce checkout (qui deviendra le déploiement du client) :
```bash
BRAND=radiosoleil node scripts/build-all.mjs
```
Injecte la marque (HTML, manifest, nginx, couleurs, flux) + copie les assets.
> ⚠️ Ne **pas** committer ce build sur `main` (qui reste la baseline Hits Dance).
> Utiliser une **branche par client** ou un dépôt/checkout dédié.
>
> ⚠️ **Rebâtir après un changement de config** : repartir d'un arbre propre, sinon
> les valeurs déjà remplacées restent figées :
> ```bash
> git checkout main -- .                       # restaure la baseline
> BRAND=radiosoleil node scripts/build-all.mjs # rebâtit proprement
> ```

---

## Étape 4 — Déployer sur Railway (1 projet par client)

🔒 Dans un **nouveau projet Railway** :

1. **PostgreSQL** (plugin) → fournit `DATABASE_URL`.
2. **Service `api`** (Root Directory `api`) — variables :
   ```
   DATABASE_URL    = ${{Postgres.DATABASE_URL}}
   JWT_SECRET      = <openssl rand -base64 48>   (UNIQUE par client)
   ALLOWED_ORIGINS = https://<domaine-site>,https://<domaine-admin>
   SEED_BRAND      = radiosoleil        ← contenu de DÉPART du client (jamais Hits Dance)
   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD = bootstrap du superadmin client
   NODE_ENV        = production
   PUBLIC_SITE_URL / ADMIN_BASE_URL = domaines du client
   ```
   (optionnel : `S3_*`, `SENTRY_DSN`, `RESEND_API_KEY`, `VAPID_*` par client)
3. **Service `web`** (Root Directory `/`) — sert le build brandé (branche client).
4. **Service `admin`** (Root Directory `admin`) — variable
   `NEXT_PUBLIC_API_URL = https://<api-du-client>`.
5. **Generate Domain** (ou domaine custom) pour `web`, `api`, `admin`.

> L'API applique migrations + seed automatiquement au déploiement
> (`preDeployCommand`). Le contenu Hits Dance n'est **jamais** seedé chez un client.
>
> **Seed de départ (optionnel)** — si un bundle existe pour la marque dans
> `api/src/db/seeds.ts` (ex. `rockradio` → `seed-rockradio.ts`), la radio **boote
> avec SA grille / SES animateurs / SES émissions**, que l'équipe n'a plus qu'à
> ajuster dans l'admin (au lieu de tout taper). Sans bundle, la base démarre
> vierge. Dans les deux cas le seed initial ne s'applique qu'à une **base vierge** :
> les éditions faites ensuite dans l'admin ne sont **jamais écrasées**, même si le
> seed retourne à chaque déploiement.
>
> → Pour préparer un seed de départ : créer `api/src/db/seed-<slug>.ts` (4 exports :
> artists, shows, schedule, hostToArtistSlug) et l'enregistrer dans `seeds.ts`.

---

## Étape 5 — Vérifier

🧰 Une fois l'API en ligne :
```bash
node scripts/verify-deploy.mjs https://<api-du-client>
```
Doit afficher 4 ✅ (API/DB, grille, animateurs, push). Puis :
- ouvrir le **site** → player live joue le flux du client ;
- ouvrir l'**admin** → login superadmin → créer un animateur de test.

---

## Étape 6 — Livraison au client

- Former le client à l'admin (≈ 30 min) : animateurs, émissions, grille, podcasts, stats.
- Remettre les accès admin ; lui faire **changer son mot de passe** (page `/compte`).
- Inviter ses animateurs par email (bouton « Inviter », si Resend configuré).
- ⚖️ Archiver l'attestation de licences dans le registre client.

---

## Checklist express

- [ ] Infos + assets + ⚖️ attestation licences reçus
- [ ] `new-client.mjs` → config remplie + assets déposés
- [ ] `BRAND=<slug> build-all` sur branche/checkout client
- [ ] Railway : Postgres + api + web + admin, variables posées (dont `SEED_BRAND`)
- [ ] Domaines générés + `ALLOWED_ORIGINS` à jour
- [ ] `verify-deploy.mjs` → 4 ✅
- [ ] Formation + accès remis + mot de passe changé
- [ ] Client ajouté au registre (Phase 3)
