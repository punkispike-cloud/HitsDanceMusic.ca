# Hits Dance Music — La radio

> 📌 **Le projet a évolué en plateforme complète** (site + API + admin + Postgres sur Railway).
> **Pour reprendre le travail / comprendre où on en est : voir [ETAT-DU-PROJET.md](ETAT-DU-PROJET.md).**
> **Durcissement prod (3 vagues) : [RUNBOOK-PRODUCTION.md](RUNBOOK-PRODUCTION.md).**
> Détails : [api/README.md](api/README.md) · [admin/README.md](admin/README.md) · [DEPLOY-RAILWAY.md](DEPLOY-RAILWAY.md).

Site statique (HTML / CSS / JS) pour la landing page et quelques pages satellites. Le site lit désormais son contenu (grille, animateurs, émissions) depuis l'API et envoie des données d'audience ; il garde un fallback statique si l'API est injoignable.

## Fichiers principaux

- `index.html` — accueil : hero, lecteur live, grille **programmation 2026** (7 jours), équipe, contact **Alain Perron** · **418 261‑2886**.
- `styles.css` — manifest de `@import` ; le code CSS réel est dans `styles/` (29 fichiers thématiques numérotés, l'ordre d'import préserve la cascade).
- `js/main.js` — point d'entrée modules ES (chargé via `<script type="module">`). 42 modules dans `js/` : player, schedule, presence, watch, lyrics, install-pwa, etc. Voir `js/main.js` pour l'ordre d'init.
- `assets/theme-init.js` — bootstrap thème inline anti-FOUC, chargé tôt dans le `<head>`.
- `assets/favicon.svg` — favicon **HR**.
- `assets/landing-bg.webp` — visuel hero (overlay assombri en CSS).
- `presence/server.js` — micro-service WebSocket optionnel pour compteur live (origines vérifiées, plafond MAX_CONNECTIONS, dédup par clientId UUID).
- `nginx.conf` — CSP stricte sans `script-src 'unsafe-inline'`, proxy `/np` pour now-playing sans dépendre de proxies CORS publics, MIME types pour modules ES.

Pages optionnelles : `animateurs.html`, `horaire.html`, `emissions.html`, `contact.html`, `stats.html`, `404.html`.

## Flux radio

Le flux est défini dans `index.html` :

```text
https://cast5.asurahosting.com/start/hitsdanc/
```

L’élément `<audio>` lit ce flux **sans quitter la landing** ; le lien « Ouvrir dans un autre onglet » charge uniquement la page du fournisseur dans un second onglet. Pas d’attribut `crossorigin` sur `<audio>` : sinon beaucoup de flux Icecast / SHOUTcast refusent la lecture (CORS).

Depuis les pages satellites, la barre **Écouter le direct** pointe vers `index.html?play=1#player` : à l’arrivée sur l’accueil, le lecteur défile à l’écran et la lecture démarre (puis le paramètre `play` est retiré de l’URL pour éviter une relance au rafraîchissement).

## Déploiement

1. Téléverse **tout le dossier** à la racine de ton hébergement (ou branche un dépôt Git vers **Netlify**, **Cloudflare Pages**, **GitHub Pages**, **Vercel** en mode site statique).
2. Sert le site en **HTTPS** pour éviter les blocages « mixed content » sur le flux audio.
3. Pour les partages sociaux (`og:image`), remplace l’URL relative dans les balises Open Graph par une **URL absolue** du type `https://tondomaine.com/assets/radio-studio-hero.svg` (ou une image PNG carrée dédiée).

## Checklist avant mise en ligne

- [ ] Tous les fichiers listés ci‑dessus sont présents ; aucun `src` / `href` local ne pointe vers un fichier manquant.
- [ ] Le flux audio joue après un clic sur « lecture » (politique des navigateurs).
- [ ] Menu mobile : ouverture / fermeture, lien **Contact** et ancres fonctionnent.
- [ ] Coordonnées studio à jour (téléphone, e‑mail `mailto:` si tu en ajoutes un réel).
- [ ] `og:image` en URL absolue une fois le domaine connu.

## Modifier le contenu

- Marque : chercher `Hits Dance Music` et `Les Hits Dance Music`.
- Grille : la source unique est `SCHEDULE` dans `js/schedule.js` (le DOM est généré).
- Lecteur : textes d'état dans `js/player.js` (`setPlayingUI`).
- Thème : tokens couleurs dans `styles/00-base.css` (variables `:root`).
- **Header, presence-badge, header-tools, head-icons** : éditer le fichier dans `_partials/`, puis lancer `node scripts/build-html.mjs` pour propager sur les 7 HTML.

## Tests

Suite unitaire sur les fonctions pures (zéro dépendance, Node 18+ built-in test runner) :

```sh
npm test                                # tout ( = node --test tests/ )
node --test tests/parsing.test.mjs       # parser now-playing
node --test tests/time.test.mjs          # TZ + helpers
node --test tests/schedule.test.mjs      # grille hebdomadaire
node --test tests/store.test.mjs         # localStorage wrapper (mode privé safari)
```

Couvre : parsing des chaînes Centova/SHOUTcast (10 formats), continuité 24/7 de la grille des 7 jours, conversion UTC → heure Toronto, dégradation gracieuse de `localStorage` en mode privé.

Tests visuels (Playwright) — 9 pages × 3 viewports (mobile/tablette/desktop), comparaison pixel à pixel :

```sh
npm run test:visual      # = snap:check — compare aux baselines versionnées
npm run snap:baseline    # régénère les baselines (après un changement de rendu intentionnel)
```

Le serveur statique de test est `tests/visual/serve.mjs` (Node 18+, **aucune dépendance Python**) : `python -m http.server` est remplacé car il servait les modules ES de façon non concurrente (graphe `main.js` → 40+ imports) → rendu tronqué. `serve.mjs` sert les bons types MIME (notamment `text/javascript` pour les `.js`/`.mjs`) et gère la concurrence. Baselines : `tests/visual/*-snapshots/` (versionnées).

Consentement audience (Loi 25 / RGPD) : la mesure d'audience (`js/analytics.js`) et le compteur de présence (`js/presence.js`) ne démarrent qu'après consentement (`js/consent.js`, bannière `#consentBar`, clé localStorage `hr.consent`). Bouton « Modifier mes choix » sur `confidentialite.html`. L'identifiant anonyme `hr.clientId` a une source unique, `js/client-id.js`, avec deux accès à ne pas confondre : `getClientId()` (lecture seule, ne crée rien — pour tout code qui part automatiquement, ex. le widget sondage) et `ensureClientId()` (crée au besoin — réservé aux modules déjà conditionnés au consentement et aux actions déclenchées par la personne : vote, 🤘, formulaire, rappels push). Refuser ou retirer son choix efface l'identifiant. En test visuel, le consentement est forcé à `no` (`addInitScript`) → pas de bannière ni de collecte, captures focalisées sur le rendu.

## Checklist visuelle (post-déploiement)

Baselines Playwright en place (9 pages × 3 viewports). En plus, vérifier manuellement après une mise en prod :

- [ ] Hero + lecteur live affichés correctement sur l'accueil
- [ ] Click play → flux démarre dans les 3 s (cf. logs console pour erreur reconnect)
- [ ] Volume + mute fonctionnent (clavier ↑↓ M, souris)
- [ ] Menu burger mobile s'ouvre/ferme proprement
- [ ] Mini-player apparaît au scroll hors du player principal
- [ ] Menu "Plus" (⋯) ouvre tel/SMS/WhatsApp/contact
- [ ] Bouton install affiché tant que non installé
- [ ] Drawer historique s'ouvre via touche H
- [ ] Mode plein écran (touche W) affiche le bon titre/host/morceau
- [ ] Paroles (touche L) tente une recherche LRCLib
- [ ] Thème clair/sombre/auto (bouton header) — sans flash au reload
- [ ] Compteur presence visible si `hr-presence-url` configuré
- [ ] DevTools → onglet Application → Service Worker → version active = celle de `sw.js` actuelle

## Build scripts

Pipeline complet (`scripts/build-all.mjs`) : build-brand → build-css → build-html → build-sw.

```sh
npm run build              # = node scripts/build-all.mjs — applique la marque + régénère tout
npm run check              # = node scripts/build-all.mjs --check — exit 1 si quelque chose est hors sync (CI)

node scripts/build-html.mjs          # propage les partials vers les *.html (idempotent)
node scripts/build-html.mjs --check  # exit 1 si HTML hors sync

node scripts/build-sw.mjs            # bumpe CACHE dans sw.js selon hash SHA-256 du SHELL
node scripts/build-sw.mjs --check    # exit 1 si CACHE hors sync avec contenu réel
```

Dépendance npm : `lightningcss` (build CSS) + `@playwright/test` (tests visuels) → `npm install`. Node 18+ requis. Workflow recommandé : `npm run build` avant chaque `git commit` (ou `npm run check` en CI).

- `build-css` : bundle la chaîne de `@import` de `styles.css` en UN fichier `styles.bundle.css` (cascade préservée, iso-rendu). Option prod : `npm run build:css:minify` (ou `CSS_MINIFY=1 node scripts/build-css.mjs`) → bundle minifié (artefact de déploiement, ne pas committer — le bundle versionné reste non minifié).
- `build-html` : remplace le contenu entre `<!--#include name="X"-->` et `<!--#endinclude-->` par `_partials/X.html`.
- `build-sw` : régénère `const CACHE` dans `sw.js` à partir du hash du contenu réel des ressources du SHELL — invalidation auto à toute modif de JS/CSS/HTML/asset. Avertit aussi si un module `js/*.js` n'est pas dans le SHELL (drift) ou si un fichier listé est manquant.

## Sitemap & SEO

`sitemap.xml` liste les pages indexables (accueil, animateurs, horaire, emissions, podcasts, contact, confidentialite). Les pages `noindex` (`stats.html`, `404.html`) en sont exclites. Référencé depuis `robots.txt`. `sw.js` précache `styles.bundle.css` (et non l'ancienne chaîne `styles.css` + partials).

## Ouvrir en local

Ouvre `index.html` dans un navigateur ou lance un petit serveur statique dans ce dossier pour tester sans restriction CORS éventuelle sur le flux.
