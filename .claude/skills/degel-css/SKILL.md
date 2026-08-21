---
name: degel-css
description: >-
  Travailler sur le CSS du site public Hits Dance, qui est GELÉ : tokens de
  design, couleurs, espacements, thème clair/sombre, !important, cascade des
  @import, bundle Lightning CSS, filet de captures Playwright. Utiliser avant
  toute retouche d'apparence, tout ajout de token, ou pour reprendre la
  migration Phase 5 là où elle en est.
metadata:
  origin: projet
---

# Toucher au CSS gelé (Phase 5)

Plan de référence : `PLAN-PHASE5-DEGEL-CSS.md`. Constats d'origine :
`PLAN-CORRECTION-UIUX.md`.

## Pourquoi c'est gelé

33 `@import` en cascade stricte où l'ordre est un contrat implicite, des
composants redéfinis plusieurs fois, et des couleurs recopiées en dur dans 32
fichiers. Une retouche isolée est imprévisible : elle peut casser une couche
correctrice (`19-phase1-polish`, `25-mobile-perfection`, `28-player-2026`) sans
qu'on le voie avant la production.

D'où la règle : **on ne relooke pas avant d'avoir tokenisé**, parce que relooker
d'abord reviendrait à modifier les hex un par un — exactement la dette qu'on veut
sortir, en pire.

## Le rituel, à chaque fois

```bash
npm run snap:check    # AVANT de toucher à quoi que ce soit — DOIT être vert
# … modification …
npm run build         # brand → css → html → sw
npm run snap:check    # APRÈS — diff vide = iso-rendu
```

**Lancer `snap:check` d'abord n'est pas une formalité.** Le filet a déjà été
trouvé rouge sur `main` (10 échecs sur 27) parce que les baselines avaient
vieilli face à des évolutions légitimes du contenu. Un filet rouge ne prouve
rien : on ne peut plus distinguer une régression d'une dérive. Le réparer d'abord,
en vérifiant chaque diff **image par image**, avant de conclure quoi que ce soit.

Deux points à savoir :
- Le filet **ne tourne pas en CI** (baselines win32). C'est un contrôle **local
  et manuel** — consigner son résultat dans le message de commit.
- `node scripts/build-all.mjs --check`, lui, tourne en CI : c'est la garantie que
  `BRAND=hitsdance` reste un NO-OP.
- Friction Windows connue : après un `git checkout`, `styles.bundle.css` ressort
  en CRLF et fait échouer `npm run check` jusqu'à un `npm run build`. Sans effet
  en CI (Linux, LF).

## Architecture des tokens

Trois étages, dans cet ordre de cascade :

1. **Primitif** — `styles/00-tokens-primitive.css`. Palette brute non-marque
   (`--red-700`, `--gray-970`, `--white-a08`, `--size-4`, `--rad-12`, `--dur-3`…).
   Chaque token porte sa fréquence d'usage en commentaire.
2. **Sémantique** — bloc `:root` de `styles/00-base.css`. Dit un **rôle**
   (`--bg`, `--accent`, `--line`) et pointe sur une primitive. **Aucune valeur
   littérale ne doit y réapparaître.**
3. **Marque** — `styles/brand.css`, généré par `scripts/build-brand.mjs`,
   **importé en dernier donc gagnant**. Surcharge l'accent, et les neutres si la
   marque déclare `palette.semantic.dark`.

## État de la migration

| Étape | Contenu | État |
|---|---|---|
| 0 | Filet Playwright (`tests/visual/`) | ✅ |
| 1 | Bundle iso-rendu Lightning CSS → `styles.bundle.css` | ✅ |
| 2 | Couche primitive déclarative | ✅ |
| 3 | Sémantique branchée + neutres par marque | ✅ |
| **4** | **Consolider les couleurs en dur des composants** | **⬜ suivante** |
| 5 | Dé-importanter (cible < 20) | ⬜ |
| 6 | Light/dark + dégel de `js/theme.js` | ⬜ |
| 7 | Relooking — le but | ⬜ |

**Étape 4** : cibler `19-phase1`, `28-player-2026`, les slots de `01-`, les
partners de `22-`. Priorité aux `rgba(220,20,48,…)` → `rgba(var(--red-glow-rgb), …)`.
**Une famille de couleur par commit**, `snap:check` à chaque.

## Décisions en attente — ne pas trancher seul

**Les deux rouges.** `--accent` vaut `#c8102e` (`--red-700`), mais toute la lueur
est bâtie sur `rgb(220,20,48)` = `#dc1430` (`--red-650` / `--red-a*`), qui n'en
dérive pas. Les tokens les gardent **délibérément distincts**. Les unifier
**changerait l'apparence** : c'est une décision du porteur du projet, à prendre
à l'étape 4 avec la mesure sous les yeux.

## Pièges concrets

- **Noms hérités trompeurs** : `--amber`, `--amber-soft`, `--amber-glow`,
  `--amber-slot` contiennent des **rouges** ; `--gold-border` est un **blanc
  translucide**. Ne pas les renommer au passage : `build-brand.mjs` les génère et
  du CSS les consomme. C'est un refactor à part entière.
- **Contrat CSS↔JS — ne JAMAIS renommer** : `is-playing, is-open, is-min, is-drag,
  is-hidden, is-shown, is-active, is-past, is-offline, is-scrolled, is-loading,
  just-muted, stagger-ready, revealed, has-bottom-nav`, plus `.player-panel`,
  `.player-panel.is-playing`, `.player-2026`, `.p26-*`, `.np-drawer`,
  `.mini-player`, `data-theme`. Les renommer casse le player et les tiroirs
  **silencieusement**.
- **Thème clair = code mort non testé.** `js/theme.js` fige `data-theme="dark"`,
  donc `15-` et `27-theme-light.css` ne s'activent jamais. Ne pas s'y fier avant
  l'étape 6.
- **Lightning CSS normalise les couleurs** mais préserve les `var()` :
  `rgba(220,20,48,0.14)` devient `#dc143024` dans le bundle. C'est ce qui permet
  de *prouver* qu'un mapping 1:1 est iso-rendu plutôt que de le supposer.
- **`!important` de deux natures** : ~5 légitimes (`[hidden]`,
  `prefers-reduced-motion`, `.sr-only`) à conserver et documenter ; le reste sont
  des hacks d'ordre à convertir en tokens de composant à l'étape 5.

## Accessibilité

`node scripts/check-contrast.mjs` vérifie **toutes** les marques de `brand/`
(pas seulement l'active) et tourne en CI via `tests/contrast.test.mjs`. Tout
neutre ajouté à une marque doit tenir AA : 4,5:1 pour le texte, 3:1 pour le
texte large. `--muted` doit rester ≥ 4,5:1 sur `--surface` **et** sur `--bg`.
