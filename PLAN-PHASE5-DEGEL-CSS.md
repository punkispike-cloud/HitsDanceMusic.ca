# Plan de dégel CSS — Phase 5 (Hits Dance Music)

> Objectif porteur : pouvoir **retoucher l'apparence** (couleurs, espacements, typo, profondeur, light/dark) **sans régression visuelle**. Prérequis technique avant toute retouche : **bundler + tokeniser**. Ce document est le plan d'exécution, ancré au code réel.
>
> _Issu d'un audit multi-agents (2026-06-26) ; chiffres mesurés, non estimés._

---

## 1. Objectif & principe

Le frontend est **gelé** précisément parce qu'aujourd'hui une retouche d'apparence est imprévisible : 33 fichiers en cascade stricte, 92 `!important`, 281 couleurs hex en dur, des composants redéfinis 3× (player). Changer une couleur d'accent ou un espacement peut casser une couche correctrice (`19-phase1-polish`, `25-mobile-perfection`, `28-player-2026`) sans qu'on le voie avant la prod.

**Principe directeur : on ne touche pas à l'apparence tant que deux verrous ne sont pas posés.**

1. **Filet anti-régression** (screenshots de référence multi-viewports) — pour *prouver* qu'un changement est iso-rendu.
2. **Bundler + tokeniser** — pour *transformer un changement diffus en un changement local* :
   - **Bundler** : remplacer la cascade fragile de 33 `@import` (où l'ordre est tout) par **un artefact compilé et ordonné**, vérifiable, sans dépendance au runtime du navigateur pour résoudre les imports.
   - **Tokeniser** : faire passer les 281 hex / ~233 rgba / durées d'un état « éparpillé et dupliqué » à **une seule source de vérité** (couche primitif → sémantique → composant). Une fois tokenisé, « changer le rouge » = changer 1 token, pas 44 occurrences de `#c8102e` + 13 de `rgba(220,20,48,…)`.

**Pourquoi bundler+tokeniser AVANT de relooker** : relooker d'abord reviendrait à modifier les hex en dur un par un dans 32 fichiers — exactement la dette qu'on veut sortir, en pire (on en rajoute). La tokenisation est le *seul* moyen de rendre le relooking ultérieur sûr et réversible.

---

## 2. État des lieux (synthèse ancrée)

**Chiffres réels (vérifiés)** : 32 partiels, ~6193 lignes ; **33 `@import`** dans `styles.css` (00-base → 30-podcasts + `brand.css` en dernier) ; **92 `!important`** ; **281 hex** + ~233 rgba ; **59 `--var`**. `styles.css` est référencé par **9 pages HTML** via `<link rel="stylesheet" href="styles.css">`.

**Pipeline build existant** (à réutiliser, pas à remplacer) : `scripts/build-all.mjs` → `build-brand.mjs` (génère `styles/brand.css` + `js/brand.generated.js` depuis `brand/*.json`) → `build-html.mjs` (inline partials) → `build-sw.mjs` (hash cache). `build-brand` part **toujours** de la baseline `hitsdance` (NO-OP garde-fou).

**Vraies sources de fragilité** (pas du décompte, du couplage) :

| Source | Détail | Pourquoi c'est dangereux |
|---|---|---|
| **Ordre des @import = contrat implicite** | Commentaire en tête de `styles.css` : « Ne pas modifier l'ordre sans audit visuel ». Les phases 19→28 sont des **couches correctrices empilées** qui dépendent de venir *après* leur cible. | Tout reordering ou bundling naïf casse la préséance. |
| **Composants redéfinis N×** | `.player-cover` (03/19/28), `.player-live-badge` (03/19/28) : deux UI (`.player-panel--signature` *vs* `.player-2026`) du **même** composant cohabitent. | Une retouche sur l'un peut fuir sur l'autre arbre DOM. |
| **`!important` de deux natures** | ~5 *légitimes* (`[hidden]`, `prefers-reduced-motion`, `.sr-only`) ; ~87 *hacks d'ordre/spécificité* (logo final, dimensions tactiles 72/56px, gradients accent). | Mélangés, on ne sait plus lesquels on peut retirer. |
| **Couleur dupliquée hors token** | `220,20,48` recopié en dur partout au lieu de `--accent-glow-rgb` ; light theme (`15-` + `27-`) 100 % hex en dur, **0 var()**. | « Changer le rouge » = chasse au texte dans 32 fichiers ; light theme ne suit pas la marque. |
| **Contrat CSS↔JS** | Classes d'état lues/basculées par `js/*.js` : `is-playing, is-open, is-min, is-drag, is-hidden, is-shown, is-active, is-past, is-offline, is-scrolled, is-loading, just-muted, stagger-ready, revealed, has-bottom-nav`, + sélecteur parent `.player-panel.is-playing` et `data-theme`. | Renommer une classe en refactorant casse le player/drawers/nav silencieusement. |
| **Light theme gelé** | `js/theme.js` force `data-theme="dark"` (`cycleTheme` = no-op). `27-theme-light.css` ne s'active jamais. | Le light est du code mort *non testé* → piège pour le dégel. |

---

## 3. Approche technique

### 3.1 Choix du bundler : **Lightning CSS** (recommandation ferme)

**Recommandé : Lightning CSS** (`lightningcss`, binaire Rust, API Node), invoqué depuis un nouveau `scripts/build-css.mjs` inséré dans `build-all.mjs`.

**Justification (vs PostCSS, vs esbuild)** :

- **Réutilise l'infra existante** : c'est un appel Node, exactement comme `build-brand.mjs`. On ajoute une étape au pipeline `spawnSync` de `build-all.mjs`, zéro nouveau paradigme. Pas de `postcss.config.js` + chaîne de plugins à maintenir. Pas d'esbuild (orienté JS ; son CSS bundling est plus rudimentaire pour autoprefix/minify CSS pur).
- **`@import` inlining natif** : Lightning résout et **inline** la chaîne de `@import` *dans l'ordre exact du fichier source* → la cascade actuelle est préservée bit-à-bit. C'est le cœur du besoin.
- **Autoprefix piloté par `browserslist`** : permet de purger sereinement les `-webkit-`/`-moz-` legacy (sliders `input[type=range]`) plus tard, et de garantir le fallback `env(safe-area-*)`.
- **Minify + sourcemap** : artefact prod compact (~15 KB gzip attendu) + sourcemap pour debug.
- **Garde la philosophie « build node statique servi par nginx »** : aucune runtime dependency ajoutée côté navigateur.

> Repli acceptable si on refuse une dépendance Rust binaire : **PostCSS + `postcss-import` + `autoprefixer` + `cssnano`**. Même architecture d'étape, plus de surface de maintenance. Lightning reste préféré.

### 3.2 De 33 `@import` → un bundle ordonné

`scripts/build-css.mjs` :

1. Lit `styles.css` (la liste des 33 `@import` **est** la déclaration d'ordre — on ne réécrit pas l'ordre, on le respecte).
2. `lightningcss.bundle({ filename: 'styles.css' })` → inline tout dans l'ordre source.
3. Sortie : `styles.bundle.css` (+ `.map`).
4. Les 9 pages HTML pointent vers `styles.bundle.css` au lieu de `styles.css` (un remplacement, via le mécanisme de `build-html.mjs` ou un find/replace contrôlé).
5. `build-sw.mjs` hash le bundle final (déjà prévu : « hash à partir du contenu FINAL »).

**Position dans `build-all.mjs`** : `build-brand` (génère `brand.css`) → **`build-css` (NOUVEAU : bundle, brand.css inclus en dernier)** → `build-html` → `build-sw`. `brand.css` reste **le dernier `@import`** donc inliné en dernier → préséance marque conservée.

**Garde-fou itération 0 (iso-rendu)** : le tout premier bundle doit être **visuellement identique** à la cascade `@import` actuelle (aucune tokenisation encore). C'est le point de bascule : on prouve par screenshots que `styles.bundle.css` == ancien rendu, *puis seulement* on commence à modifier le contenu.

### 3.3 Couche de tokens primitif → sémantique → composant (générée par le build)

On étend `build-brand.mjs` (qui ne génère aujourd'hui que 9 var() de couleur dans `brand.css`) pour produire une **vraie couche tokens**, ordonnée AVANT `00-base.css`.

- **Primitif** (`styles/00-tokens-primitive.css`, statique, non-marque) : palette brute (rouges, gris, neutres), échelle d'espacement, rayons, durées, easings, typo. ~40 tokens primitifs absorbent les 281 hex.
- **Sémantique** (généré par marque, depuis `brand/*.json` étendu) : `--bg, --surface, --ink, --line, --accent, --accent-bright, --accent-glow-rgb, --slot-{morning,drive,limelight,night,special}, --shadow-*`. **Deux jeux** : `:root` (dark) et `:root[data-theme="light"]`.
- **Composant** : `--player-cover-size`, `--play-button-size`, `--header-safe-area`, `--range-thumb-size`, `--badge-*` — dérivés des deux couches au-dessus. C'est ce qui tue les `72px !important` / `56px !important`.

**Extension `brand/*.json`** : ajouter une section `palette: { semantic: { dark: {…}, light: {…} } }` (le schéma actuel n'a que 8 clés couleur). `build-brand.mjs` lit cette section et génère `styles/tokens-semantic-<BRAND>.css`. Garde la règle existante : baseline `hitsdance` = NO-OP.

**Ordre @import final** : `00-tokens-primitive` → `00-base` (devient sémantique, map 1:1) → `01…30` → `brand.css` → `tokens-semantic-<BRAND>.css` → `27-theme-light` (overrides light).

---

## 4. Filet anti-régression (à poser AVANT de toucher au CSS)

**Outil : Playwright** (screenshot multi-viewport + diff pixel via `toHaveScreenshot`), lancé contre le site servi en statique localement. Stocké dans `tests/visual/`.

**Matrice viewports** (couvre les vrais breakpoints du code : 380 / 560 / 900 px + desktop) :
`375×812` (iPhone, safe-area/notch), `390×844`, `560×900`, `768×1024`, `900×1280`, `1280×800`, `1600×1000`.

**Pages capturées** (les 9 qui chargent `styles.css`) : `index`, `emissions`, `horaire`, `animateurs`, `podcasts`, `stats`, `contact`, `confidentialite`, `404`.

**États à figer en plus du défaut** (ce sont eux qui révèlent les régressions) :
- **Player** : repos *et* `.player-panel.is-playing` (cover glow, equalizer, vinyl rotate), badge live.
- **Player 2026** vs signature (les deux arbres si activables).
- **Drawers/overlays** : `.np-drawer.is-open`, history drawer `is-shown`, mini-player `is-shown/is-hidden`, palette de recherche `is-open`.
- **`prefers-reduced-motion: reduce`** (flag Playwright) — vérifie que les resets `!important` tiennent.
- **JS désactivé** : capture cascade « nue » pour distinguer régression CSS vs régression JS.
- **Light theme** : *préparer* le harnais maintenant, mais ne l'activer comme baseline que quand on dégèle `theme.js` (étape 6).
- **`BRAND=rockradio`** : un build alternatif pour vérifier que la tokenisation marque tient (or `#cf9b3f` vs rouge).

**Process** : `npm run snap:baseline` (capture référence sur la cascade actuelle) → toute étape de migration suivante lance `npm run snap:check` → **diff doit être vide** (ou diff *intentionnel* documenté et re-baseliné). C'est le critère de merge.

---

## 5. Séquence de migration (du moins risqué au plus couplé)

> Chaque étape : **testable** (snap:check) et **réversible** (commit isolé, `git revert` propre). On ne passe à l'étape N+1 que si N est iso-rendu (ou diff intentionnel validé).

**⚠️ Classes/états pilotés par JS — NE JAMAIS renommer ni supprimer** (et préserver le sélecteur parent quand il existe) :
`is-playing, is-open, is-min, is-drag, is-hidden, is-shown, is-active, is-past, is-offline, is-scrolled, is-loading, just-muted, stagger-ready, revealed, has-bottom-nav`, `.player-panel`, `.player-panel.is-playing`, `.player-2026`, `.p26-*`, `.np-drawer`, `.mini-player`, `data-theme`. Avant toute étape de consolidation : `grep -rn 'classList\|querySelector\|matches(' js/*.js` pour figer la liste exacte du contrat.

**Étape 0 — Filet (aucun risque visuel).**
Poser Playwright + matrice viewports/états + `snap:baseline` sur la cascade actuelle. *Livrable : référence verte. Réversible : c'est du test, zéro impact prod.*

**Étape 1 — Bundling iso-rendu (isoler).**
Ajouter `scripts/build-css.mjs` (Lightning, inline des 33 `@import` dans l'ordre), insérer dans `build-all.mjs`, faire pointer les 9 HTML vers `styles.bundle.css`. **Aucune modification de contenu CSS.** `snap:check` doit être **vide**. *Réversible : revenir au `<link>` vers `styles.css`.*

**Étape 2 — Couche primitive (tokeniser, étage 1).**
Créer `00-tokens-primitive.css` (palette/spacing/radius/durations/easings), importé en premier. **Sans rien changer aux valeurs** : on déclare les tokens, on ne les utilise pas encore ailleurs. `snap:check` vide. *Réversible : supprimer le fichier.*

**Étape 3 — Sémantique 00-base (tokeniser, étage 2, map 1:1).**
Réécrire les valeurs de `00-base.css` en `var(--token-primitif)` **strictement 1:1** (ex. `--accent: var(--red-600)` où `--red-600: #c8102e`). Étendre `brand/*.json` + `build-brand.mjs` pour générer la couche sémantique par marque. `snap:check` vide en dark. Build `BRAND=rockradio` pour valider la paramétrisation. *Réversible par fichier.*

**Étape 4 — Consolider les couleurs en dur (composants).**
Remplacer les hex/rgba dupliqués des composants (`19-phase1`, `28-player-2026`, slots de `01-`, partners de `22-`) par `var(--token)`. Cibler en priorité les `rgba(220,20,48,…)` → `rgba(var(--accent-glow-rgb), …)`. Fusionner les quasi-doublons. **Une famille de couleur par commit** + `snap:check` à chaque. *Réversible finement.*

**Étape 5 — Dé-importanter (réduire `!important`).**
Garder les ~5 légitimes (`[hidden]`, `prefers-reduced-motion`, `.sr-only`) — **documentés, on n'y touche pas**. Convertir les hacks : dimensions tactiles `72/56px !important` → tokens composant (l'ordre du bundle rend le `!important` inutile) ; logo final → spécificité maîtrisée plutôt que reset `!important`. Cible : **< 20 `!important`**. *Un fichier/commit, snap:check à chaque.*

**Étape 6 — Light/dark (le plus couplé côté JS).**
Réécrire `15-` + `27-theme-light` en termes sémantiques (`:root[data-theme="light"] { --bg: …; --ink: … }`), fusionner en un seul fichier, supprimer les hex en dur. **Puis** dégeler `js/theme.js` (`cycleTheme` réel, watchers). Ajouter le light à la baseline de screenshots. Première étape où un **diff visuel intentionnel** est attendu. *Réversible : re-figer `theme.js` en dark, le CSS light redevient dormant.*

**Étape 7 — Relooking (le but du dégel).**
Maintenant seulement : retoucher couleurs/espacements/profondeur via les tokens. Chaque changement = diff de tokens, screenshots intentionnels validés par le porteur. *C'est devenu local et réversible — l'objectif est atteint.*

---

## 6. Effort, jalons, risques & rollback

**Effort (ordres de grandeur)** :

| Étape | Effort | Jalon |
|---|---|---|
| 0 — Filet Playwright | 1–2 j | **J1 : référence verte** |
| 1 — Bundling iso-rendu | 1 j | **J2 : bundle == cascade (prouvé)** |
| 2–3 — Primitif + sémantique 1:1 | 2–3 j | **J3 : tokens en place, dark iso-rendu, rockradio OK** |
| 4 — Consolidation couleurs | 2–3 j | 281 hex → ~40 tokens |
| 5 — Dé-importanter | 2 j | `!important` < 20 |
| 6 — Light/dark + dégel theme.js | 2–3 j | **Light fonctionnel et testé** |
| 7 — Relooking | à la demande | dégel effectif |

Total prérequis (0→5, dette neutralisée sans changement visuel) : **~8–11 j**. Le relooking (7) est ensuite incrémental et peu risqué.

**Risques & rollback** :

- **Reordering implicite cassé au bundling** → mitigation : Lightning inline dans l'ordre source ; **snap:check** vide à l'étape 1 est la preuve. Rollback : `<link>` vers `styles.css` (1 ligne × 9 pages).
- **Régression de couleur silencieuse à la consolidation** → mitigation : map 1:1 vérifiée, une famille/commit. Rollback : `git revert` du commit de famille concerné.
- **Casse JS par renommage de classe** → mitigation : liste de classes figée par grep avant l'étape 5, **interdiction de renommer**. Rollback : revert ; les snapshots « JS désactivé » isolent CSS vs JS.
- **`env(safe-area-*)` sur vieux navigateurs** → mitigation : centraliser en token avec fallback `0px`, autoprefixer via browserslist ; viewport iPhone dans la matrice.
- **Light theme dégelé instable** → mitigation : étape 6 en dernier, derrière un flag `theme.js` ; rollback = re-figer dark, CSS light redevient dormant.
- **Réversibilité globale** : chaque étape = commit isolé sur branche dédiée ; le bundle prod reste un *artefact généré* — on peut toujours retomber sur la cascade `@import` source tant que les 9 `<link>` pointent dessus.

---

## 7. Quick check — ce qui peut démarrer **maintenant** sans rien casser

**Préparable tout de suite (zéro risque visuel)** :
- **Poser le filet Playwright** : matrice 7 viewports × 9 pages × états (`is-playing`, drawers ouverts, reduced-motion, JS off) + `snap:baseline`. Outillage de test, aucun impact prod.
- **Ajouter `scripts/build-css.mjs` (Lightning) + étape dans `build-all.mjs`** et produire un `styles.bundle.css` **iso-rendu** (inline pur des 33 `@import`, contenu inchangé). Valider par `snap:check` vide. Pointer les HTML sur le bundle est réversible en 1 ligne.
- **Geler le contrat CSS↔JS** : `grep -rn 'classList\|querySelector\|matches(' js/*.js` → liste des classes/états intouchables, en tête du futur fichier tokens et dans la mémoire projet.
- **Cartographier les 92 `!important`** en deux paquets (légitimes à garder / hacks à convertir) — pur audit.

**À attendre (changement de contenu / couplage) — derrière le filet vert** :
- Réécriture sémantique de `00-base` (étape 3) et consolidation des couleurs (étape 4).
- Suppression des `!important` de hack (étape 5).
- **Dégel de `js/theme.js` + light theme** (étape 6).
- **Relooking** (étape 7) — seulement une fois les tokens en place et la référence visuelle stable.

> **Règle d'or du dégel : aucune retouche d'apparence ne précède un `snap:baseline` vert et un bundle iso-rendu prouvé.**
