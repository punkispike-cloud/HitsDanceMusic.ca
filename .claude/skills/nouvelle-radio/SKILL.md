---
name: nouvelle-radio
description: >-
  Créer, bâtir et déployer une nouvelle radio cliente En Ondes : scaffold d'une
  marque, remplissage de brand/<slug>.json, build brandé, déploiement Railway,
  vérification E2E, livraison. Utiliser dès qu'il s'agit d'ajouter un client,
  rebâtir une marque existante, ou comprendre pourquoi un build client a
  bousillé l'arbre de travail.
metadata:
  origin: projet
---

# Onboarder une radio cliente

Runbooks de référence, à lire avant d'agir : `ONBOARDING-CLIENT.md` (procédure
générique) et `LANCEMENT-ROCKFORT.md` (cas réel, flux sans AzuraCast).

## ⚠️ Le piège qui coûte du travail

`scripts/build-brand.mjs` **réécrit l'arbre de travail en place** : HTML racine,
partials, `manifest.webmanifest`, `nginx.conf`, `sw.js`, `styles/brand.css`,
`js/brand.generated.js`, et copie `brand/<slug>/assets/` par-dessus `assets/`.

Il faut donc restaurer après coup — et **`git checkout -- .` détruit aussi tes
modifications non commitées**. C'est déjà arrivé : tout un lot de travail perdu.

**Règle : commiter AVANT de bâtir une marque cliente.**

```bash
git status --short                          # DOIT être vide
BRAND=<slug> node scripts/build-all.mjs
# … vérifications …
git checkout -- .                           # restauration
rm -f assets/.gitkeep                       # laissé non suivi par la copie d'assets
node scripts/build-all.mjs                  # revenir explicitement à la baseline
git status --short                          # DOIT être vide
```

Corollaire du modèle de remplacement (baseline → client) : **un build client part
toujours d'un arbre propre**. Rebâtir un client par-dessus un build client
précédent fige des valeurs déjà remplacées.

## Séquence

### 1. Scaffold

```bash
node scripts/new-client.mjs <slug> "Nom de la radio"
```

Crée `brand/<slug>.json` (gabarit à compléter) + `brand/<slug>/assets/`. Ne
touche à rien d'autre.

### 2. Remplir `brand/<slug>.json`

C'est **la** source de vérité du client. Champs qui font vraiment le branchement :

- `stream.url` / `stream.panel` / `stream.host` / `stream.nowPlayingProxy` — tant
  qu'ils valent `CHANGEME`, la radio n'est branchée sur rien.
- `urls.api` / `urls.presenceWss` — les services Railway du client.
- `colors.*` — accent de marque (`accent`, `accentBright`, `accentGlowRgb`…).
- `palette.semantic.dark` (optionnel) — **neutres** : fonds, surfaces, encre,
  bordures. Absent ⇒ la marque hérite de la baseline. Voir `degel-css` pour la
  couche de tokens.
- `contact.phone` / `contact.email`, `domain`, `genre`, `description`.

Tout neutre ajouté doit passer le contraste : `node scripts/check-contrast.mjs`
vérifie **toutes** les marques de `brand/` et échoue en CI si l'une descend sous
AA (4,5:1 texte, 3:1 large).

### 3. Assets

Déposer logo, favicon, icônes 192/512 dans `brand/<slug>/assets/`. Sans ça, le
client hérite silencieusement des icônes Hits Dance.

### 4. Bâtir

```bash
BRAND=<slug> node scripts/build-all.mjs
```

Pipeline : `build-brand` → `build-css` → `build-html` → `build-sw`.

### 5. Déployer (1 projet Railway par client)

Services : `api`, `admin`, `site-<slug>`, `presence`, `db`.

**Décision produit à ne pas rater — semer vide ou non.** Déployer l'API **sans**
`SEED_BRAND=<slug>` fait démarrer la radio vierge. C'est le choix retenu pour
Rockfort : une station honnête qui démarre, avec des états vides assumés
(« la programmation se bâtit »), plutôt que du contenu inventé. Poser
`SEED_BRAND` réinjecte le bundle de démonstration — ne le faire que si le client
le demande explicitement.

### 6. Vérifier

```bash
node scripts/verify-deploy.mjs <url-api>
```

Contrôle `/health` (API + DB), `/v1/schedule`, `/v1/artists`, `/v1/schedule/now`,
la clé VAPID Web Push, `/v1/admin/media` (auth requise) et le webhook Stripe.

Puis, côté écoute : `node scripts/check-stream.mjs <stream.url>` — voir la skill
`flux-radio` pour lire le ratio.

### 7. Livrer

Compte admin, runbook client, attestation de licences musicales. Voir
`ONBOARDING-CLIENT.md` § Étape 6.

## Garde-fou permanent

`BRAND=hitsdance` (le défaut) doit rester un **NO-OP** : le site live ne change
pas d'un pixel. C'est vérifié en CI par `node scripts/build-all.mjs --check`. Si
ce check casse après une modification de `build-brand.mjs`, c'est la modification
qui est fautive, pas le check.

## Licences musicales

Pour un pilote sans auditeurs : sources gratuites/libres (Pixabay, Internet
Archive Live Music Archive, artistes indé avec permission écrite). SOCAN /
Re:Sound deviennent nécessaires au passage à de la musique commerciale diffusée
publiquement — l'attestation de licences fait partie de la collecte d'onboarding.
