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

- [ ] Registre des clients (`brand/clients.json` : slug, domaines, projet Railway, statut)
- [ ] Mises à jour mutualisées : déployer un correctif à TOUS les clients proprement
- [ ] Monitoring centralisé (Sentry par projet + page statut up/down)
- [ ] Sauvegardes Postgres vérifiées + procédure de restauration testée
- [ ] (option) Mini tableau de bord opérateur (santé de tous les sites)

## Phase 4 — Self-service client (l'utilisateur gère SON site) ⬜

- [ ] Admin : page « Réglages du site » (nom, contact, réseaux, couleurs) éditables par le client
- [ ] Upload du logo / favicon depuis l'admin
- [ ] Le client = superadmin de SA radio (rôles affinés)
- [ ] Aide / guide intégré dans l'admin

## Phase 5 — Multi-tenant + portail Autologix ⬜ (à ~5 clients)

- [ ] Cloison par `radio_id` (1 plateforme, N radios dans la même base)
- [ ] Portail Autologix : créer / configurer / suspendre un client en quelques clics
- [ ] Facturation intégrée (Stripe) reliée aux paliers

## Phase 6 — Commercial / go-to-market ⬜ (documents privés, hors repo)

- [ ] Page de vente + démo (Hits Dance Music)
- [ ] Grille de prix par palier d'auditeurs (build + mensuel + add-ons)
- [ ] Acquisition : DJ, radios communautaires, OBNL, festivals QC

---

## Références

- `PLATEFORME-MULTI-RADIO.md` — conception technique (3 couches, productisation)
- `brand/README.md` — champs de la config par client
- `DEPLOY-RAILWAY.md` — déploiement (mono-client, base à généraliser en Phase 2)
- `ETAT-DU-PROJET.md` — état + reprise sur Mac
- `AUDIT.md` — revue qualité/sécurité
