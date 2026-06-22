# 🗺️ Roadmap — Plateforme Radio-as-a-Service

> 📝 « Autologix » n'est qu'un **nom de travail** dans ce document — le nom final
> de l'entreprise/marque reste **à choisir** (ce ne sera pas « Autologix »).
> Dans les documents commerciaux, le placeholder est `[ENTREPRISE]`.

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

> **Phases 1-2-3 outillées, 4 recadrée, 6 en gabarits.** Le code de l'« usine »
> (cloner + onboarder + gérer le parc) est **complet et opérationnel** ; le pack
> commercial/légal est **rédigé** (`_private/`, à valider par avocat·e). Site live
> Hits Dance **inchangé**. **Il ne reste que des décisions/actions 🔒 à TOI** :
> choisir le nom, faire valider les contrats, activer Sentry/backups, roter les
> secrets — puis **trouver le 1er vrai client**. La seule phase code restante est
> la 5 (multi-tenant), **différée à ~5 clients**.

---

## Vue d'ensemble

| Phase | Objectif | Statut |
|---|---|---|
| 0 | Plateforme pour 1 radio (Hits Dance Music) | ✅ fait |
| 1 | Productisation : rendre le code **clonable** | ✅ fait |
| 2 | Onboarding **turnkey** : créer un client vite | ✅ fait |
| 3 | Gestion **centralisée** (côté opérateur) | ✅ outillée |
| 4 | Périmètre client (contenu) vs **IP visuel Autologix** | 🔁 recadrée |
| 5 | **Multi-tenant** + portail Autologix | ⬜ (à ~5 clients) |
| 6 | **Commercial** / go-to-market | 🔁 gabarits prêts |

---

## Phase 0 — Plateforme (1 radio) ✅

- [x] API backend (Hono + Drizzle + Postgres) : auth JWT + refresh, RBAC
- [x] Admin Next.js : CRUD animateurs / émissions / grille / podcasts / mixes / utilisateurs
- [x] Analytics d'audience (sessions, écoute/émission, géo-IP) + page stats
- [x] Podcasts & mixes (upload S3 🔒, player public, RSS)
- [x] Web Push (rappels 🔒 clés VAPID), Open Graph, journal d'audit
- [x] Monitoring Sentry 🔒, emails invitations/reset 🔒, 27 tests, CI
- [x] Déployé sur Railway (api, admin, presence, web, Postgres)

> ✅ **Secrets rotés le 2026-06-22** : `JWT_SECRET`, mot de passe **Postgres** et mot
> de passe **admin** renforcés (via CLI Railway, secrets jamais exposés ; runbook
> `SECURITE-ROTATION.md`). Reste 🔒 (toi) : activer S3 / VAPID / Resend / Sentry
> (variables d'env) + **drill de restauration** Postgres (PITR déjà actif).
> Voir `ETAT-DU-PROJET.md` §0.

## Phase 1 — Productisation (clonable) 🔄

- [x] Source unique par client : `brand/<client>.json` (nom, couleurs, flux, URLs, contact)
- [x] `scripts/build-brand.mjs` injecte la marque (HTML, manifest, nginx, CSS, JS)
- [x] `scripts/build-all.mjs` (brand → html → sw) + `--check` en CI
- [x] Flux audio + URLs + couleurs pilotés par config
- [x] Seed paramétrable `SEED_BRAND` (nouveau client = DB vierge)
- [x] Garde-fou : `BRAND=hitsdance` = no-op (site live identique au pixel) — **vérifié**
- [x] Robustesse : hash SW insensible CRLF/LF, test JWT flaky corrigé
- [x] **Copie auto des assets** par client (`brand/<client>/assets/` → `assets/`)
- [x] `/np` (proxy now-playing nginx) paramétrable par client (`stream.host` + `nowPlayingProxy`)

## Phase 2 — Onboarding turnkey ✅

- [x] `scripts/new-client.mjs <slug> "Nom"` : scaffold `brand/<slug>.json` + dossier assets
- [x] `ONBOARDING-CLIENT.md` : runbook détaillé pas-à-pas (collecte → build → deploy → livraison)
- [x] Checklist + modèle de variables d'env Railway par client (dont `SEED_BRAND`)
- [x] `scripts/verify-deploy.mjs` : santé (`/health`, `/v1/schedule`, `/v1/artists`, push)
- [x] ⚖️ Attestation licences intégrée à la collecte + à la checklist
- [x] Objectif **< 1 journée** outillé (scaffold + build + deploy + vérif)

## Phase 3 — Gestion centralisée (opérateur) ✅ outillée

> **Pour QUI** : pour TOI. Gérer tous les clients d'un seul endroit, sans te
> connecter à 10 panneaux Railway. C'est ce qui rend « 10 clients » tenable.

- [x] **Registre des clients** : `brand/clients.json` (slug, domaines, branche,
      projet Railway, palier, statut, **licences**, date). Source de vérité.
- [x] **Statut du parc** : `scripts/status.mjs` (ping `/health` de chaque client →
      🟢/🔴 + DB + temps + rappel licences). = le tableau de bord opérateur (CLI).
- [x] **Mises à jour mutualisées** : `scripts/update-clients.mjs` (guide les commandes
      par client) + `OPERATIONS.md` (le process).
- [x] **Monitoring** documenté : Sentry **par projet** (DSN distinct) — gated, à activer 🔒
- [x] **Sauvegardes** Postgres : **PITR continu activé** + snapshot manuel (2026-06-22)
- [x] **Restauration testée** : drill logique 2026-06-22 (dump → restore base jetable,
      comptes identiques prod/restauré, **RTO ~4 s** sur la base actuelle)
- [ ] (plus tard) Tableau de bord opérateur **web** (la version CLI suffit pour démarrer)
- 📓 Bible opérateur : `OPERATIONS.md`

## Phase 4 — Périmètre client vs IP Autologix (RECADRÉE 2026-06-19) ⬜

> **DÉCISION STRATÉGIQUE** : Autologix **conserve la propriété intellectuelle de la
> création et du visuel** de chaque radio. Le client ne modifie **pas** son
> apparence — c'est l'actif d'Autologix (moat + dépendance = récurrent). On sépare
> donc nettement ce qui est **au client** de ce qui reste **à Autologix**.

**Au client (self-service) — CONTENU & opérationnel :**
- [x] Animateurs, émissions, grille, podcasts, mixes (déjà via l'admin ✅)
- [x] Statistiques d'audience, notifications, son mot de passe (déjà ✅)
- [ ] (option) Coordonnées / réseaux sociaux (données opérationnelles, pas créatives)

**À Autologix (contrôlé par l'opérateur) — CRÉATION & VISUEL = IP :**
- [ ] Le visuel reste **figé au build** (`brand/<client>.json`) — non exposé au client
- [ ] (option) **Panneau opérateur** pour ajuster le visuel d'un client sans rebuild
      manuel (réservé Autologix, pas le client)
- [ ] ⚖️ **Clause de PI au contrat** : Autologix détient le design/visuel ; le client
      a une **licence d'utilisation** tant qu'il est abonné → **Phase 6 (légal)**

> Conséquence : la grosse archi « réglages runtime éditables par le client » n'est
> **plus nécessaire**. Le self-service client se limite au **contenu** (déjà fait).
> Ce qui prend de la valeur, c'est plutôt la **Phase 3** (toi, opérateur, qui
> contrôles et gères tous les visuels/clients d'un seul endroit).

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

## Phase 6 — Commercial / go-to-market 🔁 gabarits prêts (dossier privé `_private/`)

> **Pour QUI** : pour vendre. Tenu **hors du dépôt** (prix, contrats) → `_private/`
> (gitignoré). Nom d'entreprise en placeholder `[ENTREPRISE]` (pas « Autologix »).

- [x] **Contrat client** (`_private/CONTRAT-CLIENT.md`) — PI (visuel = au Prestataire,
      licence d'usage au Client), licences musicales, données, paiement, résiliation.
- [x] **Attestation licences** (`_private/ATTESTATION-LICENCES.md`) — SOCAN + Ré:Sonne.
- [x] **Grille de prix** (`_private/GRILLE-PRIX.md`) — build + mensuel/palier + add-ons + point mort.
- [x] **Page de vente** (`_private/PAGE-DE-VENTE.md`) — argumentaire, démo = Hits Dance, FAQ.
- [ ] 🔒 **Validation juridique** des gabarits (avocat·e QC) — avant 1er vrai client
- [ ] 🔒 **Choisir le nom** d'entreprise/marque (remplacer `[ENTREPRISE]`)
- [ ] 🔒 Acquisition : DJ, radios communautaires, OBNL, festivals QC francophones

---

## 🎚️ Couche transversale — Expertise radio & musique

> Une plateforme logicielle ne suffit pas : une **radio** a des exigences métier.
> Le principe : **toute cette complexité est cachée** ; l'utilisateur ne voit que
> de la simplicité. Ces items irriguent toutes les phases.

- [x] **⚖️ Licences musicales (P0 légal) — DÉCIDÉ (2026-06-19)** : **le client détient
      SES licences** SOCAN (auteurs/éditeurs) + Ré:Sonne (artistes/labels). Autologix
      **exige une attestation signée à l'onboarding** (case à cocher + champ dans le
      registre client) et n'héberge pas de diffusion non licenciée. → à intégrer dans
      `ONBOARDING-CLIENT.md` (Phase 2) et le registre clients (Phase 3).
- [ ] **📻 Diffusion & AutoDJ** — le flux audio (live + rotation auto quand pas
      d'animateur) est aujourd'hui chez **AsuraHosting**. À cadrer dans l'offre :
      qualité, failover, multi-bitrate, mount points. Le « cœur radio ».
- [ ] **🌍 Portée / découverte** — le gros levier d'audience qu'un host pro offre :
      listing **TuneIn, Radio Garden, Apple/Google**, **enceintes connectées**
      (Alexa/Google), **voiture** (CarPlay/Android Auto), flux RSS (déjà fait).
- [ ] **❤️ Engagement auditeur** — demandes de chansons & **dédicaces** (à moitié là),
      votes, historique des titres, « j'aime ». Fidélise et fait revenir.
- [ ] **💵 Monétisation outillée** — insertion programmée de **pubs/jingles**,
      créneaux commandites, page de stats pour les annonceurs (l'audience se vend).
- [ ] **🎙️ Outils animateur** — direct vs automatisé, voice-tracking, planning
      d'émissions pré-enregistrées qui passent à heure fixe.

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
