# Déploiement multi-tenant + flux AzuraCast — runbook

> Branche `feat/crm-multitenant`. Tout le **code** est fait, vérifié (typecheck +
> tests verts), **sans toucher la prod**. Ce document = les étapes **infra** qu'il
> reste à faire (ton serveur / Railway). Ordre = la « version sûre » :
> nouveaux clients d'abord, **Hits Dance en DERNIER**.

---

## 0. Ce que le code fait déjà

- **Tier `owner`** (En Ondes) au-dessus des admins clients + faille d'escalade fermée.
- **`radio_id` sur 14 tables** + backfill automatique (migration additive, aucun NOT NULL).
- **« Mur dans le code »** : chaque route/service est filtré par radio (contenu, audience, stats, push, audit, uploads).
- **Console opérateur** (`/parc` dans l'admin) : un login owner → toutes les radios, stats agrégées, sélecteur de radio, provisionner / suspendre.
- **Intégration AzuraCast** : à la création d'une radio, la station de flux se monte toute seule (si AzuraCast configuré).

Le système tourne en **deux modes**, sans changement de code :
- **mono-radio** (1 radio par base) → comportement identique à aujourd'hui (Hits Dance) ;
- **multi-tenant** (N radios dans une base partagée) → la console owner les voit toutes.

---

## 1. Variables d'environnement (API)

À poser sur le service `api` (Railway) :

| Variable | Rôle | Obligatoire |
|---|---|---|
| `SEED_OWNER_EMAIL` | Compte propriétaire En Ondes (créé/**promu** en `owner` au déploiement) | pour avoir l'accès owner |
| `SEED_OWNER_PASSWORD` | Mot de passe initial de ce compte | idem |
| `SEED_RADIO_NAME` | Nom affiché de la radio du tenant (déf. dérivé de `SEED_BRAND`) | optionnel |
| `AZURACAST_BASE_URL` | URL de ton serveur AzuraCast (ex. `https://stream.enondes.ca`) | pour le flux managé |
| `AZURACAST_API_KEY` | Clé API admin AzuraCast | idem |

> Sans `AZURACAST_*`, le provisioning crée la radio **sans station** (tu branches le flux à la main via `streamUrl`/`nowPlayingUrl`).

---

## 2. Monter le serveur AzuraCast (Phase 3)

1. **Serveur à bande passante à plat** (Hetzner / OVH) — ⚠️ **jamais** un hyperscaler facturé à l'egress (25 To/mois ≈ 5 € vs 2 250 $).
   - Reco départ : VPS **Dedicated CPU** (le transcodage tourne 24/7), ~4-8 Go RAM.
2. **Installer AzuraCast** (Docker, officiel) :
   ```bash
   curl -fsSL https://raw.githubusercontent.com/AzuraCast/AzuraCast/main/docker.sh > docker.sh
   chmod +x docker.sh
   ./docker.sh install
   ```
3. **DNS + TLS** : pointer un sous-domaine (ex. `stream.enondes.ca`) vers le serveur ; AzuraCast gère Let's Encrypt nativement.
4. **Compte admin + clé API** : créer le super-admin, puis générer une **API Key** (My Account → API Keys). C'est `AZURACAST_API_KEY`.
5. Poser `AZURACAST_BASE_URL` + `AZURACAST_API_KEY` sur l'`api`.

> ⚖️ **Licences (non négociable)** : chaque radio cliente doit détenir **SOCAN + Re:Sound (Tarif 8, via Entandem)**. C'est au client (déjà dans `_private/CONTRAT-CLIENT.md` + `ATTESTATION-LICENCES.md`).

---

## 3. Onboarder une nouvelle radio (ex. Rockfort) — Phase 2

Deux façons selon l'architecture choisie :

### A. Instance dédiée (comme aujourd'hui, le plus simple)
Nouveau projet Railway + sa base, `SEED_BRAND=rockradio`. La radio démarre seule (mono-radio). L'owner y voit 1 radio. Runbook existant : `ONBOARDING-CLIENT.md`.

### B. Tenant dans la base PARTAGÉE (la vraie console « toutes mes radios »)
Sur le déploiement multi-tenant (un seul `api` + une seule base + `SEED_OWNER_*`) :
1. Se connecter à l'admin **en owner**.
2. Onglet **Parc** → **Provisionner une nouvelle radio** (nom, domaines, et — si AzuraCast configuré — la station se monte toute seule).
3. La radio apparaît dans le parc ; **« Administrer »** la sélectionne (en-tête `X-Radio-Id`) → tout l'admin bascule sur elle.
4. Saisir le contenu (animateurs / émissions / grille) via l'admin, déposer les médias.

> Pour la **console unifiée**, c'est l'option **B**. On y met **Rockfort + futurs clients d'abord** (radios non-critiques) pour prouver l'isolation, **avant** d'y migrer Hits Dance.

---

## 4. Migrer Hits Dance — EN DERNIER (Phase 10)

Deux scénarios :

- **Hits Dance reste sur son instance actuelle** : déployer cette branche dessus = **migration sûre et automatique** (la migration ajoute `radio_id` nullable, le seed crée la radio `hitsdance` + back-remplit toutes les lignes existantes). **Comportement identique** (1 radio). Rien à faire de plus. ✅ **Aucun risque** (additif).
- **Consolider Hits Dance dans la base partagée** (pour l'avoir dans la console avec les autres) : opération sensible →
  1. **Sauvegarde** + snapshot de la base partagée ET de Hits Dance.
  2. Créer la radio `hitsdance` dans la base partagée (Parc).
  3. Copier le contenu/comptes de Hits Dance vers la base partagée en **réécrivant `radio_id`** = id de la radio `hitsdance`.
  4. Bascule du domaine + **plan de rollback** prêt.
  5. Vérifs (site live OK avant/après).

> Tant qu'il n'y a pas de besoin pressant, **garder Hits Dance sur son instance** (1er scénario) est le choix sûr.

---

## 5. Durcissement RLS (Phase 5/6) — migration posée, activation progressive

Le « mur dans le code » est **déjà** l'isolation effective. Le **RLS Postgres** est une **deuxième barrière** (la base refuse une fuite même si un futur code oublie un filtre). État :

- **Migrations 0022 → 0024** : `ENABLE ROW LEVEL SECURITY` + policy `tenant_isolation` sur 21 tables tenant (policy = tout visible tant que `app.radio_id` est vide).
- **Migration `0025_force_rls`** : `FORCE ROW LEVEL SECURITY` sur les 21 tables + création du rôle applicatif `enondes_app` (LOGIN, NOBYPASSRLS) + `GRANT` CRUD sur toutes les tables + `ALTER DEFAULT PRIVILEGES`. SÉCURITAIRE : zéro rupture (GUC vide = tout visible, migrate/seed/jobs inchangés).
- **Primitives runtime** : `api/src/db/tenant-guc.ts` — `withTenantGuc(radioId, tx => …)` (isolation tenant), `withCrossRadio(tx => …)` (owner/jobs, GUC vide), `acquireRequestDb/releaseRequestDb` (chemin middleware par requête). Posent `set_config('app.radio_id', …, true|false)`.
- **Garde statique strict** : `RLS_STRICT=1 npm run tenant:guard` signale les handlers tenant pas encore migrés vers les wrappers (66 blocs à ce jour = TODO d'activation). Mode par défaut inchangé (CI verte).
- **Test d'intégration** : `npm run test:rls` (env-driven) valide sur vraie base que le tenant A ne voit pas le tenant B (se connecter via `RLS_TEST_URL` = rôle `enondes_app` pour que RLS s'applique réellement).

**Activation (ops + code)** :
1. `ALTER ROLE enondes_app WITH PASSWORD '<fort>'` puis pointer `DATABASE_URL` du service `api` sur ce rôle.
2. Migrer les handlers tenant (`admin.ts`, `public.ts`, etc.) vers `withTenantGuc(radioId, tx => …)` — pister via `RLS_STRICT=1 npm run tenant:guard`.
3. `npm run test:rls` sur une base de test (Rockfort) → isolation confirmée.

Tant que la GUC n'est pas posée par requête, l'isolation reste assurée par le code (mur applicatif). Le RLS s'active **sans rupture** une fois les wrappers en place.

---

## 5bis. Lifecycle d'une radio (enforcement + auto-pause)

- **Enforcement `radios.status`** (middleware `tenant.ts`) : le site public
  (`publicTenant`) renvoie **503 `radio_inactive`** si la radio résolue n'est pas
  `active` (provisioning/paused). L'admin non-cross-radio (`adminTenant`) renvoie
  **423** (superadmin/animateur/lecteur bloqué sur une radio suspendue). Sont
  exemptés : webhooks Stripe, catalogue cross-radio, console owner, admin cross-radio
  (owner/it gèrent les radios provisioning/paused et la réactivation via
  `PATCH /v1/owner/radios/:id`).
- **Auto-pause Stripe** (`services/stripe.ts`) : un abonnement `canceled`/`past_due`
  cascade `radios.status = paused` (et `active`/`trialing` réactive une radio
  `paused`, sans forcer un provisioning en active). Le cache radio est invalidé à
  chaque cascade → l'enforcement s'applique aussitôt. Tests : `tests/tenant.test.ts`
  (blocage 503/423 + exemptions).
- **Cycle** : `POST /v1/owner/radios` (status=provisioning) → `npm run provision`
  (flip → active) → Stripe `canceled` → auto-pause → owner réactive via `/parc`.

---

## 6. Vérification de bout en bout

- **Owner** : 1 login → onglet **Parc** montre toutes les radios + totaux agrégés ; sélecteur de radio bascule l'admin ; provisionner crée la radio (+ station AzuraCast si configuré).
- **Isolation** : l'admin d'une radio ne voit/touche **jamais** une autre radio (contenu, stats, users, journal). Test clé à faire sur Rockfort vs Hits Dance.
- **Flux** : la radio joue sa station AzuraCast sous la marque En Ondes ; now-playing affiché.
- **Hits Dance** : après déploiement de la branche, site + admin identiques (1 radio, tout rattaché à elle).

---

## 7. Récap des commits (branche `feat/crm-multitenant`)

1. Tier owner + ancre multi-tenant
2. `radio_id` + backfill (additif)
3. Résolution tenant + lectures publiques scopées
4. CRUD admin scopé
5. Analytics / push / audit / uploads scopés
6. Console opérateur (parc, stats agrégées, sélecteur)
7. Intégration AzuraCast (provisioning auto de la station)
