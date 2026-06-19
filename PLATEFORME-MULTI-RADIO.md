# Plateforme multi-radio — Plan de conception (Radio-as-a-Service)

> Vision : transformer le système bâti pour Hits Dance Music en une **plateforme
> réutilisable** permettant d'héberger plusieurs radios clientes, en français,
> clé en main. Hits Dance Music = client #0 et vitrine.

---

## 1. Architecture en 3 couches

```
┌─────────────────────────────────────────────────────────┐
│  COUCHE 1 — L'USINE (le code, maintenu UNE fois)         │
│  api/ (Hono+Drizzle) · admin/ (Next.js) · site (PWA)     │
└─────────────────────────────────────────────────────────┘
                          │ déployée + configurée par client
                          ▼
┌─────────────────────────────────────────────────────────┐
│  COUCHE 2 — LES INSTANCES CLIENTS                        │
│  Radio A (Hits Dance) · Radio B · Radio C …              │
│  chacune = sa config + sa DB + son flux audio            │
└─────────────────────────────────────────────────────────┘
                          │ supervisée par
                          ▼
┌─────────────────────────────────────────────────────────┐
│  COUCHE 3 — TA GESTION CENTRALE (l'hébergeur)            │
│  monitoring · sauvegardes · mises à jour · support FR    │
└─────────────────────────────────────────────────────────┘
```

**Le flux audio reste externe** (AsuraHosting ou équivalent par client). La
plateforme gère tout *autour* : contenu, comptes, analytics, podcasts, engagement.

---

## 2. Ce qui est « par client » (audit du code actuel)

Aujourd'hui ces valeurs sont **codées en dur et éparpillées** → c'est le frein #1
au clonage. À centraliser dans **une config unique par client**.

| Élément | Où aujourd'hui | Ampleur | Cible |
|---|---|---|---|
| Nom de marque | 30 fichiers HTML/JS | **173 occurrences** | `site.config` + build |
| Logo / favicon / icônes | `assets/` | par fichier | dossier `brand/` par client |
| Couleurs / accent | `styles/00-base.css` (variables CSS) | variables `--accent`… | thème par client |
| Flux audio | `js/now-playing.js` (`STREAM_URL`, `PANEL_URL`) | 2 constantes | config / env |
| URLs infra (API/admin/présence) | `js/api-config.js` + balises `<meta>` HTML | ~16 fichiers | variables d'env |
| Téléphone / courriel / réseaux | HTML + `_partials/` | plusieurs | `site.config` |
| Contenu initial (animateurs, émissions, grille) | `api/src/db/seed-data.ts` | jeu complet | seed paramétrable par client |

---

## 3. Deux stratégies pour passer de 1 à N radios

| | **A. Instance par client** | **B. Multi-tenant** |
|---|---|---|
| Principe | 1 déploiement Railway + 1 DB **par** radio | 1 plateforme, plusieurs radios dans la même DB (cloison `radio_id`) |
| Effort dev | Faible (centraliser la config) | Moyen-élevé (isolation des données, auth par radio) |
| Coût ops | Croît avec le nb de radios | Quasi fixe |
| Idéal pour | **1 à 5 clients** (démarrage) | **5+ clients** (passage à l'échelle) |
| Risque | Maintenance répétée | Une faille touche tout le monde |

> **Recommandation** : commencer en **A** (rapide à vendre), basculer en **B**
> quand le carnet dépasse ~5 clients réguliers.

---

## 4. Chantier de productisation (Phase 1 — rendre le code clonable)

Objectif : qu'un nouveau client se monte en **éditant 1 config + en déployant**,
pas en cherchant-remplaçant dans 50 fichiers.

1. **Créer `brand.config.js`** (source unique) : nom, slogan, couleurs, logo,
   téléphone, courriel, réseaux sociaux, `STREAM_URL`, `PANEL_URL`, URLs API/admin/présence.
2. **Injecter la config au build** : un petit script remplace les valeurs dans le
   HTML/manifest/CSS (variables CSS pour les couleurs) à partir de `brand.config.js`.
3. **Paramétrer le flux** : `now-playing.js` lit `STREAM_URL` depuis la config.
4. **Paramétrer l'infra** : `api-config.js` + `<meta>` lisent les URLs depuis la config/env.
5. **Seed par client** : un fichier de contenu initial par radio (ou import via l'admin).
6. **Dossier `brand/`** par client : logo, favicon, image de fond, icônes PWA.

> Effort estimé : **2-4 jours de dev une fois** → ensuite chaque client = quelques heures.

---

## 5. Runbook — brancher une nouvelle radio (objectif : 1 journée)

1. **Collecter** : nom, logo, couleurs, URL du flux (leur compte AsuraHosting/Shoutcast),
   domaine, coordonnées, liste des animateurs/émissions.
2. **Config** : remplir `brand.config.js` + déposer les assets dans `brand/<client>/`.
3. **Infra** : nouveau projet Railway (api + admin + web + Postgres) OU nouvel espace
   multi-tenant ; brancher le domaine.
4. **Contenu** : seed initial OU saisie dans l'admin (animateurs, émissions, grille).
5. **Vérifs** : player live OK, admin OK, analytics qui remontent, PWA installable.
6. **Livraison** : former le client à l'admin (30 min), remettre les accès.

---

## 6. Services & gestion (ce que tu opères et factures)

**Hébergement** : Railway (services + Postgres) + S3 (podcasts/mixes). Flux audio
externe (compte client ou refacturé).

**Gestion (le récurrent que tu vends)** :
- Maintenance + **mises à jour mutualisées** (tu corriges 1 fois → tous les clients en profitent).
- **Monitoring** (Sentry) + **sauvegardes** Postgres + disponibilité.
- **Support en français**.
- **Sécurité** (auth, RBAC, rétention Loi 25 déjà en place).

**Services à valeur ajoutée (add-ons facturables)** :
- Rapport d'audience mensuel (pour leurs commanditaires).
- Hébergement + distribution **podcasts/mixes** (RSS Apple/Spotify).
- **Campagnes push** (annonces aux auditeurs).
- Application mobile (le PWA est déjà installable).
- Formation admin, refonte visuelle, fonctions sur mesure.

---

## 7. Roadmap

| Phase | Objectif | État |
|---|---|---|
| 0 | Plateforme fonctionnelle (1 radio) | ✅ fait (Hits Dance Music) |
| 1 | Productisation (config centralisée, clonable) | ⬜ à faire |
| 2 | Runbook onboarding rodé (< 1 jour/client) | ⬜ |
| 3 | 2-5 clients en « instance par client » | ⬜ |
| 4 | Multi-tenant + portail de gestion central | ⬜ (à ~5+ clients) |

> La **facturation** (grille de prix, marges, point mort) est tenue **hors de ce
> dépôt** (document privé de l'hébergeur — un dépôt client ne doit pas exposer tes prix).
