# 🗺️ Roadmap Autologix — Plateforme Radio-as-a-Service

> **But** : tout outiller pour qu'Autologix **crée, déploie et gère** des sites de
> radio complets pour ses clients — facile pour nous (l'opérateur) ET pour les
> utilisateurs (les radios). Hits Dance Music = client #0 + vitrine.
>
> **Comment suivre** : ce fichier est la **carte**. Chaque étape a un statut.
> Pendant une session de travail, la liste de tâches « live » montre où j'en suis
> en temps réel. Mets à jour les cases ici au fil de l'eau.

**Légende** : ✅ fait · 🔄 en cours · ⬜ à faire · 🔒 dépend de toi (clé/compte/action)

---

## 📍 TU ES ICI

> **Fin de Phase 1** (productisation du code = clonable). Site live Hits Dance
> **inchangé** (vérifié). Prochain : **finir Phase 1** (copie auto des assets) puis
> **Phase 2** (onboarding turnkey).

---

## Vue d'ensemble

| Phase | Objectif | Statut |
|---|---|---|
| 0 | Plateforme pour 1 radio (Hits Dance Music) | ✅ fait |
| 1 | Productisation : rendre le code **clonable** | 🔄 ~95 % |
| 2 | Onboarding **turnkey** : créer un client vite | ⬜ à faire |
| 3 | Gestion **centralisée** (côté opérateur) | ⬜ à faire |
| 4 | **Self-service** client (gérer son propre site) | ⬜ à faire |
| 5 | **Multi-tenant** + portail Autologix | ⬜ (à ~5 clients) |
| 6 | **Commercial** / go-to-market | ⬜ (hors repo) |

---

## Phase 0 — Plateforme (1 radio) ✅

- [x] API backend (Hono + Drizzle + Postgres) : auth JWT + refresh, RBAC
- [x] Admin Next.js : CRUD animateurs / émissions / grille / podcasts / mixes / utilisateurs
- [x] Analytics d'audience (sessions, écoute/émission, géo-IP) + page stats
- [x] Podcasts & mixes (upload S3 🔒, player public, RSS)
- [x] Web Push (rappels 🔒 clés VAPID), Open Graph, journal d'audit
- [x] Monitoring Sentry 🔒, emails invitations/reset 🔒, 27 tests, CI
- [x] Déployé sur Railway (api, admin, presence, web, Postgres)

> Reste 🔒 (toi) : roter secrets Postgres + `JWT_SECRET` ; activer S3 / VAPID /
> Resend / Sentry (variables d'env). Voir `ETAT-DU-PROJET.md` §0.

## Phase 1 — Productisation (clonable) 🔄

- [x] Source unique par client : `brand/<client>.json` (nom, couleurs, flux, URLs, contact)
- [x] `scripts/build-brand.mjs` injecte la marque (HTML, manifest, nginx, CSS, JS)
- [x] `scripts/build-all.mjs` (brand → html → sw) + `--check` en CI
- [x] Flux audio + URLs + couleurs pilotés par config
- [x] Seed paramétrable `SEED_BRAND` (nouveau client = DB vierge)
- [x] Garde-fou : `BRAND=hitsdance` = no-op (site live identique au pixel) — **vérifié**
- [x] Robustesse : hash SW insensible CRLF/LF, test JWT flaky corrigé
- [ ] **Copie auto des assets** par client (`brand/<client>/assets/` → `assets/`) ← prochain
- [ ] `/np` (proxy now-playing nginx) paramétrable par client

## Phase 2 — Onboarding turnkey ⬜

- [ ] `scripts/new-client.mjs <slug> "Nom"` : scaffold `brand/<slug>.json` + dossier assets
- [ ] `ONBOARDING-CLIENT.md` : runbook détaillé pas-à-pas (config → build → deploy → livraison)
- [ ] Checklist + modèle de variables d'env Railway par client
- [ ] `scripts/verify-deploy.mjs` : santé (`/health`), `/v1/schedule`, login admin
- [ ] Objectif mesurable : **brancher un client en < 1 journée**

## Phase 3 — Gestion centralisée (opérateur) ⬜

> **Pour QUI** : pour TOI. Gérer tous les clients d'un seul endroit, sans te
> connecter à 10 panneaux Railway. C'est ce qui rend « 10 clients » tenable.

- [ ] **Registre des clients** : `brand/clients.json` (slug, nom, domaines, projet
      Railway, palier, statut actif/suspendu, date de mise en service). La source
      de vérité de « qui sont mes clients ».
- [ ] **Mises à jour mutualisées** : un process pour redéployer le MÊME code corrigé
      à tous les clients sans toucher à leurs configs (script + checklist).
- [ ] **Monitoring centralisé** : Sentry par projet + une page/script « statut »
      qui ping chaque `/health` et liste up/down + audience.
- [ ] **Sauvegardes** Postgres par client + **procédure de restauration testée**
      (pas juste « activé », mais « j'ai déjà restauré une fois »).
- [ ] (option) **Mini tableau de bord opérateur** : 1 page qui liste tous les sites,
      leur santé, leur audience, la dernière mise à jour.
- 🔑 *Décision* : tableau de bord = page web dédiée, ou simple script CLI qui
  affiche le statut ? (CLI d'abord, web ensuite.)

## Phase 4 — Self-service client (l'utilisateur gère SON site) ⬜

> **Pour QUI** : pour les CLIENTS — et ça **réduit ta charge de support**. Le client
> change son nom, ses couleurs, son logo, ses coordonnées **lui-même**, sans toi.

- [ ] Admin → page **« Réglages du site »** : nom affiché, description, contact
      (tél / courriel / réseaux), couleurs d'accent — éditables par le client.
- [ ] **Upload logo / favicon** depuis l'admin (vers S3).
- [ ] Le client = **superadmin de SA radio** (rôles déjà en place, à cadrer).
- [ ] **Aide / guide** intégré dans l'admin (premiers pas).
- 🔑 *Décision d'architecture clé* : aujourd'hui la marque est **figée au build**
  (`brand/<client>.json` → injecté). Pour que le client l'édite en direct, il faut
  passer ces réglages au **runtime** (table `site_settings` servie par l'API, lue
  par le front). Choix : **tout runtime** (souple, plus de dev) **ou hybride**
  (couleurs/contact runtime ; nom/domaine restent au build). → à trancher avant Phase 4.

## Phase 5 — Multi-tenant + portail Autologix ⬜ (à ~5 clients)

> **Pour QUI** : pour TOI (passage à l'échelle). Une seule plateforme héberge N
> radios au lieu d'un déploiement par client → coût ops quasi fixe.

- [ ] **Cloison des données par `radio_id`** (chaque requête sait quelle radio ;
      isolation stricte entre clients).
- [ ] **Portail Autologix** : créer/configurer/suspendre un client via un formulaire
      (plus de déploiement Railway manuel par client).
- [ ] **Facturation Stripe** reliée aux paliers (abonnement + add-ons).
- 🔑 *Quand* : seulement à ~5 clients réguliers. Avant, « 1 instance par client »
  (Phases 1-3) est plus simple et plus sûr (une panne ≠ tout le monde tombe).

## Phase 6 — Commercial / go-to-market ⬜ (documents privés, hors repo)

> **Pour QUI** : pour vendre. Tenu **hors du dépôt client** (prix, marges).

- [ ] Page de vente + **démo live = Hits Dance Music** (« regarde ce que je fais »).
- [ ] Grille de prix par palier d'auditeurs (build one-time + mensuel + add-ons).
- [ ] Acquisition ciblée : DJ, radios communautaires, OBNL, festivals QC francophones.

---

## Dépendances entre phases (l'ordre logique)

```
0 ✅ → 1 🔄 → 2 ──┬──► 3  (gérer suppose pouvoir onboarder)
                  ├──► 4  (self-service ; dépend de la décision build/runtime)
                  └──► 5  (multi-tenant ; à ~5 clients)
6 (commercial) peut avancer EN PARALLÈLE dès qu'il y a une démo (= maintenant).
```

- **1 → 2** sont des **prérequis** : pas de gestion ni de clients sans clonage + onboarding.
- **3** dès que tu as ≥ 2 clients.
- **4** = le plus gros gain « confort utilisateur » ; nécessite la décision build vs runtime.
- **5** = pivot à l'échelle, plus tard.

---

## Références

- `PLATEFORME-MULTI-RADIO.md` — conception technique (3 couches, productisation)
- `brand/README.md` — champs de la config par client
- `DEPLOY-RAILWAY.md` — déploiement (mono-client, base à généraliser en Phase 2)
- `ETAT-DU-PROJET.md` — état + reprise sur Mac
- `AUDIT.md` — revue qualité/sécurité
